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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suffix = Date.now().toString(36);

console.log(`Smoke target: ${BASE}`);

const health = await api("/api/health");
assert(health.ok, "health did not return ok");

const openaiStatus = await api("/api/openai/status");
assert(openaiStatus.keyExposed === false, "OpenAI status must not expose keys");

const twitchStatus = await api("/api/twitch/status");
assert(twitchStatus.officialApiOnly === true, "Twitch status should declare official API only");

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
assert(approvedResult?.candidate?.id, "approved streamer should produce a safe candidate");

const packageResult = await api("/api/clips/package", {
  method: "POST",
  body: JSON.stringify({ candidateId: approvedResult.candidate.id })
});
assert(packageResult.clipPackage.id, "clip package was not created");
assert(packageResult.postingDrafts.length === 3, "expected three platform posting drafts");

const capcut = await api("/api/clips/capcut-brief", {
  method: "POST",
  body: JSON.stringify({ clipPackageId: packageResult.clipPackage.id })
});
assert(capcut.artifacts.length === 2, "CapCut brief should create TXT and JSON artifacts");

const captions = await api("/api/clips/captions", {
  method: "POST",
  body: JSON.stringify({ clipPackageId: packageResult.clipPackage.id })
});
assert(captions.artifacts.length === 2, "caption generation should create SRT and VTT");

const request = await api(`/api/posts/${packageResult.postingDrafts[0].id}/request-approval`, {
  method: "POST",
  body: "{}"
});
assert(request.request.status === "pending", "post approval request should be pending");

const queue = await api("/api/posts/queue");
assert(queue.dailyLimit.limit > 0, "daily limit should be present");

const approvals = await api("/api/human-gate/approvals");
assert(approvals.approvals.some((item) => item.status === "pending"), "Human Gate should contain pending approvals");

const artifacts = await api("/api/artifacts");
assert(artifacts.artifacts.length >= 4, "expected output artifacts");

const logs = await api("/api/logs");
assert(logs.logs.some((log) => log.type === "permission_blocked"), "permission block should be logged");
assert(logs.logs.some((log) => log.type === "package_created"), "package creation should be logged");

console.log("Smoke test passed");
