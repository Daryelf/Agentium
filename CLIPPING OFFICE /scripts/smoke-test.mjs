const BASE = process.env.SMOKE_BASE_URL || "http://localhost:4177";

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${json.error || response.statusText}`);
  }
  return json;
}

async function apiAllowError(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suffix = Date.now().toString(36);

console.log(`Smoke target: ${BASE}`);

const health = await api("/api/health");
assert(health.ok, "health did not return ok");
assert(["READY", "DEGRADED", "BLOCKED"].includes(health.readiness), "health should expose readiness");

const openaiStatus = await api("/api/openai/status");
assert(openaiStatus.keyExposed === false, "OpenAI status must not expose keys");

const twitchStatus = await api("/api/twitch/status");
assert(twitchStatus.officialApiOnly === true, "Twitch status should declare official API only");
assert(twitchStatus.rawTokensExposed === false, "Twitch status must not expose tokens");

await api("/api/demo/clear", { method: "POST", body: "{}" });

const realRun = await api("/api/agent101/runs", {
  method: "POST",
  body: JSON.stringify({
    threadId: `smoke-${suffix}`,
    goal: "Find the top 2 streamers.",
    mode: "real",
    requestedCount: 2,
    scope: "twitch_live_global"
  })
});
assert(realRun.contract.requestedCount === 2, "execution contract must honor requested count");
assert(realRun.contract.operation === "discover_streamers", "top streamer request should be discovery-only");
assert((realRun.results?.streamers || []).length <= 2, "real discovery returned more than requested");
assert((realRun.results?.candidates || []).length === 0, "discovery-only run must not create candidates");
assert((realRun.results?.postingDrafts || []).length === 0, "discovery-only run must not create posting drafts");
assert((realRun.results?.approvals || []).length === 0, "discovery-only run must not create approvals");
for (const streamer of realRun.results?.streamers || []) {
  assert(streamer.provider === "twitch", "real discovery result must be Twitch");
  assert(streamer.sourceMode === "real", "real discovery result cannot be demo");
  assert(streamer.providerUserId, "real discovery result needs provider user id");
  assert(streamer.fetchedAt, "real discovery result needs fetchedAt");
  assert(streamer.rawResponseHash, "real discovery result needs provider response hash");
}

const pending = await api("/api/twitch/streamers", {
  method: "POST",
  body: JSON.stringify({
    displayName: `Blocked Smoke ${suffix}`,
    platform: "twitch",
    channelId: `blocked_${suffix}`,
    permissionStatus: "pending",
    allowedUse: ["clips"],
    monitorEnabled: true
  })
});

const approved = await api("/api/twitch/streamers", {
  method: "POST",
  body: JSON.stringify({
    displayName: `Approved Smoke ${suffix}`,
    platform: "twitch",
    channelId: `approved_${suffix}`,
    permissionStatus: "approved",
    allowedUse: ["clips", "edits"],
    monitorEnabled: true
  })
});

const watch = await api("/api/watch/run", { method: "POST", body: "{}" });
const blockedResult = watch.results.find((item) => item.streamerId === pending.streamer.id);
const approvedResult = watch.results.find((item) => item.streamerId === approved.streamer.id);
assert(blockedResult?.skipped, "pending streamer should be skipped by permission gate");
assert(!approvedResult?.candidate, "real watch cycle must not create a candidate without verified media");

const project = await api("/api/clipping-office/project");
const demoCandidate = project.candidates?.[0];
assert(demoCandidate?.sourceId, "demo project should expose a playable source-backed candidate");

const packageResult = await api("/api/clips/package", {
  method: "POST",
  body: JSON.stringify({ candidateId: demoCandidate.id })
});
assert(packageResult.clipPackage.id, "clip package was not created");
assert(packageResult.postingDrafts.length === 0, "package creation must not create posting drafts before render verification");

const earlyPost = await apiAllowError("/api/posts/queue", {
  method: "POST",
  body: JSON.stringify({
    clipPackageId: packageResult.clipPackage.id,
    platform: "tiktok",
    caption: "Should fail without clip artifact"
  })
});
assert(earlyPost.response.status === 422, "posting draft should be blocked without verified clip artifact");

const render = await api(`/api/media/candidates/${demoCandidate.id}/render`, {
  method: "POST",
  body: "{}"
});
assert(render.artifact.id, "render should create a clip artifact");
assert(render.artifact.sha256 || render.artifact.content?.sha256, "rendered clip needs checksum");
assert(render.artifact.probeStatus === "passed" || render.artifact.content?.probeStatus === "passed", "rendered clip needs passed probe");

const draftResult = await api("/api/posting-drafts", {
  method: "POST",
  body: JSON.stringify({
    clipPackageId: packageResult.clipPackage.id,
    clipArtifactId: render.artifact.id,
    platform: "tiktok",
    caption: "Verified rendered clip draft.",
    hashtags: ["#demo"],
    thumbnailText: "DEMO"
  })
});
assert(draftResult.draft.id, "verified clip should allow a posting draft");

const request = await api("/api/human-gate/requests", {
  method: "POST",
  body: JSON.stringify({ postingDraftId: draftResult.draft.id })
});
assert(request.request.status === "pending", "post approval request should be pending");

const approvals = await api("/api/human-gate/approvals");
assert(approvals.approvals.some((item) => item.id === request.request.id), "Human Gate should contain the verified draft approval");

const logs = await api("/api/logs");
assert(logs.logs.some((log) => log.type === "candidate_blocked" || log.type === "posting_blocked"), "truth gate block should be logged");
assert(logs.logs.some((log) => log.type === "render_completed"), "verified render should be logged");

console.log("Smoke test passed");
