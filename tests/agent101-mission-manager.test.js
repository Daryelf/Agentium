const assert = require("node:assert/strict");
const test = require("node:test");

const missionManager = require("../services/agent101-mission-manager");

test("Agent 101 mission lifecycle records ordered events and durable checkpoints", () => {
  const state = {};
  const mission = missionManager.createMission(state, {
    goal: "Build and verify a complete 3D printing business operating system.",
    sessionId: "session-101",
    threadId: "thread-101",
    maxIterations: 20,
  });

  assert.equal(state.agent101Missions[0], mission);
  assert.equal(mission.status, "queued");
  assert.equal(mission.events.length, 1);
  assert.equal(mission.events[0].sequence, 1);
  assert.equal(mission.events[0].type, "mission_queued");

  missionManager.transition(mission, "running", {
    stage: "business_blueprint",
    message: "Building the business blueprint.",
  });
  missionManager.appendEvent(mission, "tool_completed", "Blueprint saved.", {
    iteration: 3,
    status: "working",
  });
  mission.toolCallCount = 4;
  mission.outputFiles = ["business/BLUEPRINT.md", "business/FINANCIAL_MODEL.json"];
  const checkpoint = missionManager.checkpoint(mission, {
    stage: "business_blueprint",
    summary: "Blueprint and financial model are durable.",
  });

  assert.equal(mission.status, "running");
  assert.equal(mission.attempts, 1);
  assert.equal(mission.startedAt !== null, true);
  assert.deepEqual(mission.events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(mission.iteration, 4);
  assert.equal(checkpoint.eventSequence, 3);
  assert.equal(checkpoint.toolCallCount, 4);
  assert.equal(checkpoint.outputFileCount, 2);
  assert.match(checkpoint.summary, /durable/i);
});

test("a waiting mission resumes only after every linked approval is approved", () => {
  const state = {};
  const mission = missionManager.createMission(state, {
    goal: "Apply the approved project UI edit.",
    autoResume: true,
  });
  mission.approvalIds = ["approval-source", "approval-publish"];
  missionManager.transition(mission, "waiting_approval", {
    stage: "human_gate",
    message: "Waiting for exact Human Gate scopes.",
  });

  assert.equal(missionManager.resumable(mission, []), false);
  assert.equal(missionManager.resumable(mission, [
    { id: "approval-source", status: "approved" },
    { id: "approval-publish", status: "pending" },
  ]), false);
  assert.equal(missionManager.resumable(mission, [
    { id: "approval-source", status: "approved" },
    { id: "approval-publish", status: "approved" },
  ]), true);

  missionManager.transition(mission, "recovering", {
    stage: "resume",
    message: "All exact approvals are present; recovering from checkpoint.",
  });
  missionManager.transition(mission, "running", {
    stage: "apply_approved_change",
    message: "Resumed from the durable checkpoint.",
  });
  missionManager.transition(mission, "completed", {
    stage: "verified",
    message: "Mission outputs verified.",
    response: "The approved edit is applied and verified.",
  });

  assert.equal(mission.status, "completed");
  assert.equal(mission.progress, 100);
  assert.equal(mission.cancellable, false);
  assert.equal(mission.response, "The approved edit is applied and verified.");
  assert.ok(mission.checkpoints.length >= 4);
  assert.throws(
    () => missionManager.transition(mission, "running"),
    /cannot transition/i
  );

  const publicView = missionManager.publicMission(mission, { includeEvents: false });
  assert.equal(publicView.active, false);
  assert.equal(publicView.terminal, true);
  assert.equal(publicView.events, undefined);
  assert.equal(publicView.latestEvent.type, "mission_completed");
});

