import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  BUFFER_GRAPHQL_URL,
  buildBufferMediaUrl,
  bufferMediaGrantMatches,
  createBufferMediaCapability,
  createBufferVideoDraft,
  listBufferChannels
} from "../CLIPPING OFFICE /services/buffer-publisher.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("Buffer channel discovery stays server-side and exposes only supported TikTok/Instagram metadata", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return jsonResponse({ data: { account: { organizations: [{ id: "org_1", name: "Argentum" }] } } });
    }
    return jsonResponse({
      data: {
        channels: [
          { id: "channel_ig", name: "Essentrx", service: "instagram" },
          { id: "channel_tt", name: "Essentrx Clips", service: "tiktok" },
          { id: "channel_x", name: "Ignored", service: "twitter" }
        ]
      }
    });
  };

  const result = await listBufferChannels({ apiKey: "server-secret", fetchImpl });

  assert.equal(requests[0].url, BUFFER_GRAPHQL_URL);
  assert.equal(requests[0].options.headers.authorization, "Bearer server-secret");
  assert.deepEqual(result.channels.map((channel) => channel.service), ["instagram", "tiktok"]);
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
  assert.equal(result.channels[0].organizationName, "Argentum");
});

test("Buffer video creation is hard-locked to draft and notification mode", async () => {
  let submittedInput = null;
  const fetchImpl = async (_url, options) => {
    submittedInput = JSON.parse(options.body).variables.input;
    return jsonResponse({
      data: {
        createPost: {
          __typename: "PostActionSuccess",
          post: { id: "post_123", status: "draft", dueAt: null, text: "Approved clip" }
        }
      }
    });
  };

  const result = await createBufferVideoDraft({
    apiKey: "server-secret",
    channelId: "channel_ig",
    text: "Approved clip",
    videoUrl: "https://argentum.example/apps/clipping-office/api/buffer/media/token/final.mp4",
    fetchImpl
  });

  assert.equal(submittedInput.saveToDraft, true);
  assert.equal(submittedInput.schedulingType, "notification");
  assert.equal(submittedInput.mode, "addToQueue");
  assert.equal("shareNow" in submittedInput, false);
  assert.equal(result.automaticPosting, false);
  assert.equal(result.id, "post_123");
});

test("an unexpected Buffer post status fails closed for manual review", async () => {
  const fetchImpl = async () => jsonResponse({
    data: {
      createPost: {
        __typename: "PostActionSuccess",
        post: { id: "post_unexpected", status: "scheduled", dueAt: "2026-08-23T12:00:00.000Z" }
      }
    }
  });

  await assert.rejects(
    createBufferVideoDraft({
      apiKey: "server-secret",
      channelId: "channel_ig",
      text: "Approved clip",
      videoUrl: "https://argentum.example/apps/clipping-office/api/buffer/media/token/final.mp4",
      fetchImpl
    }),
    (error) => {
      assert.equal(error.code, "buffer_unexpected_post_status");
      assert.equal(error.ambiguous, true);
      assert.equal(error.bufferPostId, "post_unexpected");
      return true;
    }
  );
});

test("Buffer media capabilities persist only a token hash and can be revoked", () => {
  const { token, grant } = createBufferMediaCapability({
    draftId: "draft_1",
    artifactId: "artifact_1",
    artifactSha256: "a".repeat(64),
    filename: "verified-final.mp4"
  });

  assert.equal(JSON.stringify(grant).includes(token), false);
  assert.equal(bufferMediaGrantMatches(grant, token, "verified-final.mp4"), true);
  assert.equal(bufferMediaGrantMatches(grant, `${token}x`, "verified-final.mp4"), false);
  assert.equal(
    buildBufferMediaUrl({
      publicOrigin: "https://argentum.example",
      mountPath: "/apps/clipping-office",
      token,
      filename: "verified-final.mp4"
    }),
    `https://argentum.example/apps/clipping-office/api/buffer/media/${token}/verified-final.mp4`
  );
  assert.throws(() => buildBufferMediaUrl({
    publicOrigin: "http://127.0.0.1:5173",
    mountPath: "/apps/clipping-office",
    token,
    filename: "verified-final.mp4"
  }), /HTTPS public origin/);

  grant.status = "revoked";
  grant.revokedAt = new Date().toISOString();
  assert.equal(bufferMediaGrantMatches(grant, token, "verified-final.mp4"), false);
});

test("Clipping Office exposes a manual-only Buffer workflow in API and UI source", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const [serverSource, appSource, rootServerSource] = await Promise.all([
    fs.readFile(path.join(root, "CLIPPING OFFICE ", "server.js"), "utf8"),
    fs.readFile(path.join(root, "CLIPPING OFFICE ", "public", "app.js"), "utf8"),
    fs.readFile(path.join(root, "server.js"), "utf8")
  ]);

  assert.match(serverSource, /bufferAutoPostingEnabled:\s*false/);
  assert.match(serverSource, /BUFFER_DRAFT_APPROVAL_TYPE\s*=\s*"buffer_post_draft"/);
  assert.match(serverSource, /approval\.consumedAt\s*=\s*consumedAt/);
  assert.match(serverSource, /saveToDraft:\s*true/);
  assert.match(appSource, /Auto-post OFF/);
  assert.match(appSource, /Create draft in Buffer/);
  assert.match(rootServerSource, /isPublicBufferMedia/);
});
