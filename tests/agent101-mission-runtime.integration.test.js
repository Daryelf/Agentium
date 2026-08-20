const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("root Agent 101 mission runtime builds, verifies, checkpoints, and persists a business website", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "argentum-mission-runtime-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  process.env.APP_MODE = "local";
  process.env.HOST = "127.0.0.1";
  process.env.ARGENTUM_DATA_DIR = dataDir;
  process.env.AI_PROVIDER = "local_demo";
  process.env.AI_MODE = "demo";
  process.env.OPENAI_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";

  const argentum = require("../server");
  t.after(async () => {
    await argentum.shutdownLocalOffices().catch(() => {});
  });

  const queued = argentum.createAgent101Mission({
    goal: "Build a 3D printing shop website called Mission Forge with Stripe checkout, an order dashboard, deployment configuration, and a handoff.",
    title: "Mission Forge verified shop",
    maxIterations: 25,
  });
  assert.equal(queued.status, "queued");

  const completed = await argentum.executeAgent101Mission(queued.id);
  assert.equal(completed.status, "completed", completed.error || completed.response);
  assert.equal(completed.provider, "local_tool_fallback");
  assert(completed.toolCallCount >= 5, "mission should use the multi-tool business builder");
  assert(completed.events.some((event) => event.type === "tool_result"), "tool events should be durable");
  assert(completed.checkpoints.length >= 2, "mission should persist multiple checkpoints");
  assert(completed.outputFiles.some((file) => /VERIFICATION\.json$/.test(file.path)), "verification evidence should be attached");
  assert(completed.outputFiles.some((file) => /BUSINESS_BLUEPRINT\.md$/.test(file.path)), "a business launch should include the operator blueprint");

  const state = JSON.parse(fs.readFileSync(path.join(dataDir, "argentum-state.json"), "utf8"));
  const persisted = state.agent101Missions.find((mission) => mission.id === queued.id);
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.progress, 100);
  assert(persisted.runId, "provider run id should be persisted on the root mission");

  const reportPath = path.join(dataDir, "clipping-office", "outputs", "websites", "mission-forge", "VERIFICATION.json");
  const verification = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(verification.verified, true);
  assert(verification.checks.some((check) => check.check === "runtime-admin-orders" && check.status === "pass"));
  assert(verification.checks.some((check) => check.check === "runtime-admin-auth" && check.status === "pass"));

  const blueprintPath = path.join(dataDir, "clipping-office", "outputs", "businesses", "mission-forge", "business-blueprint.json");
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, "utf8"));
  assert.equal(blueprint.business.name, "Mission Forge");
  assert(blueprint.operations.workflow.length >= 6, "blueprint should define an operating workflow");
  assert(blueprint.launchChecklist.length >= 6, "blueprint should define an actionable launch checklist");
  assert(blueprint.risksAndOpenDecisions.length >= 3, "blueprint should preserve unresolved operator decisions");

  const latestState = JSON.parse(fs.readFileSync(path.join(dataDir, "argentum-state.json"), "utf8"));
  const threadId = latestState.agent101ChatThreads[0].id;
  const cancellable = argentum.createAgent101Mission({
    goal: "Build a second shop that should be cancelled before any tool starts.",
    title: "Cancellation durability check",
    threadId,
  });
  const cancelled = argentum.cancelAgent101Mission(cancellable.id);
  assert.equal(cancelled.status, "cancelled");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const cancelledState = JSON.parse(fs.readFileSync(path.join(dataDir, "argentum-state.json"), "utf8"));
  assert.equal(cancelledState.agent101Missions.find((mission) => mission.id === cancellable.id)?.status, "cancelled");
  const linkedThread = cancelledState.agent101ChatThreads.find((thread) => thread.id === threadId);
  assert.equal(linkedThread.status, "cancelled");
  assert(linkedThread.messages.some((message) => message.metadata?.missionId === cancellable.id && message.status === "cancelled"));
});
