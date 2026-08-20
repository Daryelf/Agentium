const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OpenClawRuntime,
  assertValidOpenClawStartupConfig,
  openClawConversationUser,
  publicOpenClawStatus,
  readOpenClawConfig,
  safePublicError,
  validateOpenClawConfig,
} = require("../services/openclaw-runtime");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    baseUrl: "http://127.0.0.1:18789",
    gatewayToken: "secret-openclaw-token",
    defaultModel: "openclaw/default",
    timeoutMs: 120000,
    ...overrides,
  };
}

test("OpenClaw is disabled by default and does not require configuration", () => {
  const config = readOpenClawConfig({});
  const status = publicOpenClawStatus(config);

  assert.equal(config.enabled, false);
  assert.deepEqual(validateOpenClawConfig(config), []);
  assert.equal(status.status, "disabled");
  assert.equal(status.tokenConfigured, false);
});

test("OpenClaw startup validation fails only when enabled configuration is incomplete", () => {
  const config = readOpenClawConfig({
    OPENCLAW_ENABLED: "true",
    OPENCLAW_BASE_URL: "http://127.0.0.1:18789",
  });

  assert.throws(() => assertValidOpenClawStartupConfig(config), /OpenClaw is enabled/);
  assert.match(validateOpenClawConfig(config).join(" "), /OPENCLAW_GATEWAY_TOKEN/);
});

test("OpenClaw discovers models through the Gateway without leaking tokens to logs", async () => {
  const logs = [];
  const runtime = new OpenClawRuntime({
    config: baseConfig(),
    logger: (event) => logs.push(JSON.stringify(event)),
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:18789/v1/models");
      assert.equal(options.headers.authorization, "Bearer secret-openclaw-token");
      return jsonResponse({ data: [{ id: "openclaw/default" }, { id: "openclaw/research" }] });
    },
  });

  const result = await runtime.listModels();

  assert.deepEqual(result.models.map((model) => model.id), ["openclaw/default", "openclaw/research"]);
  assert.equal(logs.join("\n").includes("secret-openclaw-token"), false);
});

test("OpenClaw sends agent requests with stable application-owned conversation IDs", async () => {
  let requestBody;
  const runtime = new OpenClawRuntime({
    config: baseConfig(),
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:18789/v1/responses");
      requestBody = JSON.parse(options.body);
      return jsonResponse({ id: "resp-1", output_text: "Agent response ready." });
    },
  });

  const result = await runtime.runAgent({
    conversationId: "Main Thread 101",
    input: "Draft a safe plan.",
  });

  assert.equal(requestBody.user, "agentum-conversation:Main-Thread-101");
  assert.equal(requestBody.model, "openclaw/default");
  assert.equal(result.outputText, "Agent response ready.");
  assert.equal(result.conversationUser, openClawConversationUser("Main Thread 101"));
});

test("OpenClaw maps authentication failures into safe public errors", async () => {
  const runtime = new OpenClawRuntime({
    config: baseConfig(),
    fetchImpl: async () => jsonResponse({ error: { message: "bad token secret-openclaw-token" } }, 401),
  });

  await assert.rejects(
    () => runtime.listModels(),
    (error) => {
      const safe = safePublicError(error);
      assert.equal(safe.code, "authentication_failed");
      assert.equal(JSON.stringify(safe).includes("secret-openclaw-token"), false);
      return true;
    },
  );
});

test("OpenClaw maps rate limits, gateway failures, malformed responses, connection failures, and timeouts", async () => {
  const cases = [
    {
      name: "rate_limited",
      fetchImpl: async () => jsonResponse({ error: { message: "slow down" } }, 429),
    },
    {
      name: "gateway_failure",
      fetchImpl: async () => jsonResponse({ error: { message: "server down" } }, 503),
    },
    {
      name: "malformed_response",
      fetchImpl: async () => new Response("not json", { status: 200 }),
    },
    {
      name: "connection_failed",
      fetchImpl: async () => {
        throw new Error("fetch failed ECONNREFUSED");
      },
    },
    {
      name: "timeout",
      config: baseConfig({ timeoutMs: 5 }),
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    },
  ];

  for (const item of cases) {
    const runtime = new OpenClawRuntime({
      config: item.config || baseConfig(),
      fetchImpl: item.fetchImpl,
    });
    await assert.rejects(
      () => runtime.listModels(),
      (error) => {
        assert.equal(safePublicError(error).code, item.name);
        return true;
      },
    );
  }
});
