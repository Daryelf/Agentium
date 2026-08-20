const crypto = require("node:crypto");

const DEFAULT_OPENCLAW_BASE_URL = "http://127.0.0.1:18789";
const DEFAULT_OPENCLAW_MODEL = "openclaw/default";
const DEFAULT_OPENCLAW_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

class OpenClawRuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "OpenClawRuntimeError";
    this.code = code;
    this.status = options.status || 502;
    this.httpStatus = options.httpStatus || null;
    this.publicMessage = options.publicMessage || message;
    this.configurationErrors = Array.isArray(options.configurationErrors) ? options.configurationErrors : [];
    this.cause = options.cause;
  }

  toPublicJSON() {
    return {
      code: this.code,
      message: this.publicMessage,
      httpStatus: this.httpStatus,
      configurationErrors: sanitizeConfigurationErrors(this.configurationErrors),
    };
  }
}

function parseEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseTimeoutMs(value) {
  const parsed = Number(value || DEFAULT_OPENCLAW_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_OPENCLAW_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(parsed)));
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_OPENCLAW_BASE_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_OPENCLAW_BASE_URL;
}

function safeOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "";
  }
}

function readOpenClawConfig(env = process.env) {
  return {
    enabled: parseEnabled(env.OPENCLAW_ENABLED),
    baseUrl: normalizeBaseUrl(env.OPENCLAW_BASE_URL),
    gatewayToken: String(env.OPENCLAW_GATEWAY_TOKEN || "").trim(),
    defaultModel: String(env.OPENCLAW_DEFAULT_MODEL || DEFAULT_OPENCLAW_MODEL).trim() || DEFAULT_OPENCLAW_MODEL,
    timeoutMs: parseTimeoutMs(env.OPENCLAW_REQUEST_TIMEOUT_MS),
  };
}

function validateOpenClawConfig(config = readOpenClawConfig()) {
  const errors = [];
  if (!config.enabled) return errors;
  try {
    const url = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push("OPENCLAW_BASE_URL must use http or https.");
    }
  } catch {
    errors.push("OPENCLAW_BASE_URL must be a valid absolute URL.");
  }
  if (!config.gatewayToken) {
    errors.push("OPENCLAW_GATEWAY_TOKEN is required when OPENCLAW_ENABLED=true.");
  }
  if (!config.defaultModel) {
    errors.push("OPENCLAW_DEFAULT_MODEL is required when OPENCLAW_ENABLED=true.");
  }
  if (!Number.isFinite(Number(config.timeoutMs))) {
    errors.push("OPENCLAW_REQUEST_TIMEOUT_MS must be a number.");
  }
  return errors;
}

function sanitizeConfigurationErrors(errors = []) {
  return errors.map((error) => String(error).replaceAll("OPENCLAW_GATEWAY_TOKEN", "Gateway token"));
}

function assertValidOpenClawStartupConfig(config = readOpenClawConfig()) {
  const errors = validateOpenClawConfig(config);
  if (errors.length) {
    throw new OpenClawRuntimeError("invalid_configuration", "OpenClaw is enabled but server configuration is invalid.", {
      status: 500,
      publicMessage: "OpenClaw is enabled but server configuration is invalid.",
      configurationErrors: errors,
    });
  }
}

function openClawConversationUser(conversationId) {
  const normalized = String(conversationId || "default")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "default";
  return `agentum-conversation:${normalized}`;
}

function createRequestId() {
  return `openclaw-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function publicOpenClawStatus(config = readOpenClawConfig(), extra = {}) {
  const configurationErrors = validateOpenClawConfig(config);
  const configured = config.enabled && configurationErrors.length === 0;
  return {
    provider: "openclaw",
    mode: config.enabled ? "optional_runtime" : "disabled",
    enabled: Boolean(config.enabled),
    configured,
    connected: Boolean(extra.connected),
    status: config.enabled ? (configurationErrors.length ? "error" : extra.status || "configured") : "disabled",
    baseUrlOrigin: safeOrigin(config.baseUrl),
    defaultModel: config.defaultModel,
    timeoutMs: config.timeoutMs,
    tokenConfigured: Boolean(config.gatewayToken),
    missingConfig: config.enabled ? sanitizeConfigurationErrors(configurationErrors) : [],
    models: Array.isArray(extra.models) ? extra.models : [],
    selectedModel: extra.selectedModel || config.defaultModel,
    lastTest: extra.lastTest || null,
    lastError: extra.lastError || null,
    securityBoundary: "one_trusted_operator_per_gateway",
  };
}

function safePublicError(error) {
  if (error instanceof OpenClawRuntimeError) return error.toPublicJSON();
  return {
    code: "gateway_error",
    message: "OpenClaw Gateway could not complete the request.",
    httpStatus: error?.httpStatus || error?.status || null,
    configurationErrors: [],
  };
}

function mapHttpStatus(status, body = {}) {
  if (status === 401 || status === 403) {
    return new OpenClawRuntimeError("authentication_failed", "OpenClaw Gateway authentication failed.", {
      status,
      httpStatus: status,
      publicMessage: "OpenClaw Gateway rejected authentication. Check the server-side gateway token.",
    });
  }
  if (status === 429) {
    return new OpenClawRuntimeError("rate_limited", "OpenClaw Gateway rate limit reached.", {
      status,
      httpStatus: status,
      publicMessage: "OpenClaw Gateway rate limited the request. Wait and try again.",
    });
  }
  if (status >= 500) {
    return new OpenClawRuntimeError("gateway_failure", "OpenClaw Gateway failed.", {
      status,
      httpStatus: status,
      publicMessage: "OpenClaw Gateway failed. Check the Gateway service logs.",
    });
  }
  return new OpenClawRuntimeError("request_failed", "OpenClaw Gateway request failed.", {
    status,
    httpStatus: status,
    publicMessage: String(body?.error?.message || body?.message || `OpenClaw Gateway request failed with ${status}.`).slice(0, 240),
  });
}

function extractModelId(model) {
  if (typeof model === "string") return model;
  return String(model?.id || model?.name || model?.model || "").trim();
}

function normalizeModels(payload) {
  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  return source
    .map((model) => {
      const id = extractModelId(model);
      if (!id) return null;
      return {
        id,
        label: String(model?.label || model?.name || id),
        ownedBy: String(model?.owned_by || model?.owner || model?.provider || "openclaw"),
      };
    })
    .filter(Boolean);
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  if (typeof payload?.text === "string") return payload.text.trim();
  if (typeof payload?.message?.content === "string") return payload.message.content.trim();
  if (Array.isArray(payload?.output)) {
    return payload.output
      .flatMap((item) => item?.content || [])
      .map((part) => part?.text || part?.value || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (Array.isArray(payload?.choices)) {
    return payload.choices
      .map((choice) => choice?.message?.content || choice?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function safeLog(logger, meta) {
  try {
    logger({
      requestId: meta.requestId,
      provider: "openclaw",
      target: meta.target || null,
      durationMs: meta.durationMs,
      ok: Boolean(meta.ok),
      httpStatus: meta.httpStatus || null,
      errorCode: meta.errorCode || null,
    });
  } catch {
    // Logging must never affect agent runtime behavior.
  }
}

class OpenClawRuntime {
  constructor(options = {}) {
    this.config = options.config || readOpenClawConfig();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
  }

  assertReady() {
    if (!this.config.enabled) {
      throw new OpenClawRuntimeError("disabled", "OpenClaw runtime is disabled.", {
        status: 409,
        publicMessage: "OpenClaw runtime is disabled. Set OPENCLAW_ENABLED=true to use it.",
      });
    }
    const errors = validateOpenClawConfig(this.config);
    if (errors.length) {
      throw new OpenClawRuntimeError("invalid_configuration", "OpenClaw configuration is invalid.", {
        status: 500,
        publicMessage: "OpenClaw is enabled but server configuration is invalid.",
        configurationErrors: errors,
      });
    }
    if (typeof this.fetchImpl !== "function") {
      throw new OpenClawRuntimeError("runtime_unavailable", "Server fetch is unavailable.", {
        status: 500,
        publicMessage: "OpenClaw runtime is unavailable in this server process.",
      });
    }
  }

  async requestJson(pathname, options = {}) {
    this.assertReady();
    const requestId = options.requestId || createRequestId();
    const startedAt = Date.now();
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const target = options.target || this.config.defaultModel;
    const url = `${this.config.baseUrl}${pathname}`;
    try {
      const response = await this.fetchImpl(url, {
        method: options.method || "GET",
        headers: {
          authorization: `Bearer ${this.config.gatewayToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch (error) {
        throw new OpenClawRuntimeError("malformed_response", "OpenClaw Gateway returned malformed JSON.", {
          status: 502,
          httpStatus: response.status,
          publicMessage: "OpenClaw Gateway response was malformed.",
          cause: error,
        });
      }
      if (!response.ok) {
        throw mapHttpStatus(response.status, payload);
      }
      safeLog(this.logger, {
        requestId,
        target,
        durationMs: Date.now() - startedAt,
        ok: true,
        httpStatus: response.status,
      });
      return { requestId, payload, httpStatus: response.status, durationMs: Date.now() - startedAt };
    } catch (error) {
      const mapped = this.mapRuntimeError(error);
      safeLog(this.logger, {
        requestId,
        target,
        durationMs: Date.now() - startedAt,
        ok: false,
        httpStatus: mapped.httpStatus,
        errorCode: mapped.code,
      });
      throw mapped;
    } finally {
      clearTimeout(timeout);
    }
  }

  mapRuntimeError(error) {
    if (error instanceof OpenClawRuntimeError) return error;
    if (error?.name === "AbortError") {
      return new OpenClawRuntimeError("timeout", "OpenClaw Gateway request timed out.", {
        status: 504,
        publicMessage: "OpenClaw Gateway request timed out.",
        cause: error,
      });
    }
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("econnrefused") || message.includes("fetch failed") || message.includes("network")) {
      return new OpenClawRuntimeError("connection_failed", "OpenClaw Gateway could not be reached.", {
        status: 502,
        publicMessage: "OpenClaw Gateway could not be reached. Check that it is running on the configured private URL.",
        cause: error,
      });
    }
    return new OpenClawRuntimeError("gateway_error", "OpenClaw Gateway could not complete the request.", {
      status: 502,
      publicMessage: "OpenClaw Gateway could not complete the request.",
      cause: error,
    });
  }

  async listModels() {
    const result = await this.requestJson("/v1/models", { method: "GET", target: this.config.defaultModel });
    return {
      requestId: result.requestId,
      provider: "openclaw",
      models: normalizeModels(result.payload),
      selectedModel: this.config.defaultModel,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
    };
  }

  async testConnection() {
    const models = await this.listModels();
    return {
      success: true,
      provider: "openclaw",
      connected: true,
      selectedModel: models.selectedModel,
      models: models.models,
      requestId: models.requestId,
      durationMs: models.durationMs,
      message: models.models.length
        ? `OpenClaw Gateway is reachable. ${models.models.length} target${models.models.length === 1 ? "" : "s"} discovered.`
        : "OpenClaw Gateway is reachable, but no agent targets were returned.",
      testedAt: new Date().toISOString(),
    };
  }

  async runAgent(payload = {}) {
    const input = String(payload.input || payload.message || "").trim();
    if (!input) {
      throw new OpenClawRuntimeError("invalid_request", "Agent input is required.", {
        status: 400,
        publicMessage: "Agent input is required.",
      });
    }
    const model = String(payload.model || payload.target || this.config.defaultModel).trim() || this.config.defaultModel;
    const conversationId = String(payload.conversationId || payload.threadId || "default");
    const conversationUser = openClawConversationUser(conversationId);
    const result = await this.requestJson("/v1/responses", {
      method: "POST",
      target: model,
      body: {
        model,
        input,
        user: conversationUser,
      },
    });
    const outputText = extractResponseText(result.payload);
    if (!outputText) {
      throw new OpenClawRuntimeError("malformed_response", "OpenClaw Gateway returned no response text.", {
        status: 502,
        httpStatus: result.httpStatus,
        publicMessage: "OpenClaw Gateway response did not include usable text.",
      });
    }
    return {
      success: true,
      provider: "openclaw",
      model,
      conversationUser,
      requestId: result.requestId,
      durationMs: result.durationMs,
      outputText,
      rawId: result.payload.id || null,
    };
  }
}

module.exports = {
  DEFAULT_OPENCLAW_BASE_URL,
  DEFAULT_OPENCLAW_MODEL,
  DEFAULT_OPENCLAW_TIMEOUT_MS,
  OpenClawRuntime,
  OpenClawRuntimeError,
  assertValidOpenClawStartupConfig,
  extractResponseText,
  normalizeModels,
  openClawConversationUser,
  publicOpenClawStatus,
  readOpenClawConfig,
  safePublicError,
  validateOpenClawConfig,
};
