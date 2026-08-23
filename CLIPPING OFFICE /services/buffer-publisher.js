import crypto from "node:crypto";

const BUFFER_GRAPHQL_URL = "https://api.buffer.com";
const BUFFER_SUPPORTED_SERVICES = new Set(["instagram", "tiktok"]);
const BUFFER_REQUEST_TIMEOUT_MS = 12_000;
const BUFFER_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

function clean(value = "", limit = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function bufferError(message, options = {}) {
  const error = new Error(clean(message, 500) || "Buffer API request failed.");
  error.code = options.code || "buffer_error";
  error.statusCode = Number(options.statusCode || 502);
  error.ambiguous = options.ambiguous === true;
  return error;
}

function safeBufferChannel(channel = {}, organization = {}) {
  const service = clean(channel.service, 40).toLowerCase();
  if (!BUFFER_SUPPORTED_SERVICES.has(service)) return null;
  const id = clean(channel.id, 160);
  if (!id) return null;
  return {
    id,
    name: clean(channel.name || `${service} channel`, 160),
    service,
    organizationId: clean(organization.id, 160),
    organizationName: clean(organization.name, 160)
  };
}

async function readBoundedJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > BUFFER_RESPONSE_LIMIT_BYTES) {
    throw bufferError("Buffer returned an unexpectedly large response.", { code: "buffer_response_too_large" });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw bufferError("Buffer returned an unreadable response.", {
      code: "buffer_invalid_response",
      ambiguous: response.ok
    });
  }
}

async function bufferGraphql({ apiKey, query, variables = {}, fetchImpl = fetch, timeoutMs = BUFFER_REQUEST_TIMEOUT_MS }) {
  const key = clean(apiKey, 20_000);
  if (!key) {
    throw bufferError("Buffer is not configured. Add BUFFER_API_KEY on the server.", {
      code: "buffer_not_configured",
      statusCode: 409
    });
  }
  let response;
  try {
    response = await fetchImpl(BUFFER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
    throw bufferError(
      timedOut ? "Buffer did not answer before the request timed out." : "Buffer could not be reached.",
      { code: timedOut ? "buffer_timeout" : "buffer_unreachable", ambiguous: true }
    );
  }
  const json = await readBoundedJson(response);
  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    throw bufferError(
      unauthorized ? "Buffer rejected the configured API key." : `Buffer returned HTTP ${response.status}.`,
      {
        code: unauthorized ? "buffer_unauthorized" : "buffer_http_error",
        statusCode: unauthorized ? 401 : 502,
        ambiguous: response.status >= 500
      }
    );
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    const message = clean(json.errors[0]?.message, 300) || "Buffer rejected the GraphQL request.";
    throw bufferError(message, { code: "buffer_graphql_error" });
  }
  return json.data || {};
}

async function listBufferChannels({ apiKey, fetchImpl = fetch, timeoutMs = BUFFER_REQUEST_TIMEOUT_MS }) {
  const organizationData = await bufferGraphql({
    apiKey,
    fetchImpl,
    timeoutMs,
    query: `
      query ArgentumBufferOrganizations {
        account {
          organizations {
            id
            name
          }
        }
      }
    `
  });
  const organizations = Array.isArray(organizationData.account?.organizations)
    ? organizationData.account.organizations
        .map((organization) => ({
          id: clean(organization.id, 160),
          name: clean(organization.name, 160)
        }))
        .filter((organization) => organization.id)
        .slice(0, 50)
    : [];
  const channelGroups = await Promise.all(organizations.map(async (organization) => {
    const data = await bufferGraphql({
      apiKey,
      fetchImpl,
      timeoutMs,
      query: `
        query ArgentumBufferChannels($organizationId: OrganizationId!) {
          channels(input: { organizationId: $organizationId }) {
            id
            name
            service
          }
        }
      `,
      variables: { organizationId: organization.id }
    });
    return (Array.isArray(data.channels) ? data.channels : [])
      .map((channel) => safeBufferChannel(channel, organization))
      .filter(Boolean);
  }));
  const unique = new Map();
  channelGroups.flat().forEach((channel) => unique.set(channel.id, channel));
  return {
    organizations,
    channels: [...unique.values()].sort((left, right) => (
      `${left.service}:${left.name}`.localeCompare(`${right.service}:${right.name}`)
    ))
  };
}

function assertStablePublicVideoUrl(value = "") {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw bufferError("Buffer requires a stable public HTTPS video URL.", {
      code: "buffer_media_url_invalid",
      statusCode: 409
    });
  }
  const privateHost = parsed.hostname === "localhost"
    || parsed.hostname === "::1"
    || parsed.hostname.startsWith("127.")
    || parsed.hostname.endsWith(".local");
  if (parsed.protocol !== "https:" || privateHost || !/\.mp4$/i.test(decodeURIComponent(parsed.pathname))) {
    throw bufferError("Buffer requires a stable public HTTPS MP4 URL.", {
      code: "buffer_media_url_invalid",
      statusCode: 409
    });
  }
  return parsed.toString();
}

async function createBufferVideoDraft({
  apiKey,
  channelId,
  text,
  videoUrl,
  thumbnailOffsetMs = 2_000,
  fetchImpl = fetch,
  timeoutMs = BUFFER_REQUEST_TIMEOUT_MS
}) {
  const targetChannelId = clean(channelId, 160);
  if (!targetChannelId) {
    throw bufferError("Choose a connected Buffer channel.", {
      code: "buffer_channel_required",
      statusCode: 422
    });
  }
  const stableVideoUrl = assertStablePublicVideoUrl(videoUrl);
  const input = {
    text: clean(text, 4_000),
    channelId: targetChannelId,
    schedulingType: "notification",
    mode: "addToQueue",
    saveToDraft: true,
    assets: [{
      video: {
        url: stableVideoUrl,
        metadata: {
          thumbnailOffset: Math.max(0, Math.min(60 * 60 * 1000, Math.round(Number(thumbnailOffsetMs || 0))))
        }
      }
    }],
    source: "argentum-clipping-office"
  };
  const data = await bufferGraphql({
    apiKey,
    fetchImpl,
    timeoutMs,
    query: `
      mutation ArgentumCreateBufferVideoDraft($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              id
              text
              dueAt
              status
            }
          }
          ... on MutationError {
            message
          }
        }
      }
    `,
    variables: { input }
  });
  const payload = data.createPost || {};
  if (!payload.post?.id) {
    throw bufferError(payload.message || "Buffer did not create the draft.", {
      code: "buffer_draft_rejected"
    });
  }
  const postStatus = clean(payload.post.status, 80).toLowerCase();
  if (postStatus !== "draft") {
    const error = bufferError(
      "Buffer returned an unexpected post status. Inspect Buffer before taking any further action.",
      { code: "buffer_unexpected_post_status", ambiguous: true }
    );
    error.bufferPostId = clean(payload.post.id, 200);
    error.bufferPostStatus = postStatus || "unknown";
    throw error;
  }
  return {
    id: clean(payload.post.id, 200),
    status: postStatus,
    dueAt: payload.post.dueAt || null,
    schedulingType: "notification",
    saveToDraft: true,
    automaticPosting: false
  };
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function createBufferMediaCapability({ draftId, artifactId, artifactSha256, filename, createdAt = new Date().toISOString() }) {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    grant: {
      id: `buffer_media_${crypto.randomBytes(10).toString("hex")}`,
      draftId: clean(draftId, 160),
      artifactId: clean(artifactId, 160),
      artifactSha256: clean(artifactSha256, 128).toLowerCase(),
      filename: clean(filename, 240),
      tokenHash: sha256(token),
      status: "active",
      createdAt,
      revokedAt: null
    }
  };
}

function bufferMediaGrantMatches(grant = {}, token = "", filename = "") {
  if (!grant || grant.status !== "active" || grant.revokedAt || !grant.tokenHash) return false;
  if (clean(filename, 240) !== clean(grant.filename, 240)) return false;
  const supplied = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(String(grant.tokenHash || ""), "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function buildBufferMediaUrl({ publicOrigin, mountPath = "", token, filename }) {
  let origin;
  try {
    origin = new URL(String(publicOrigin || ""));
  } catch {
    throw bufferError("Argentum could not determine its public HTTPS origin for Buffer media.", {
      code: "buffer_public_origin_missing",
      statusCode: 409
    });
  }
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw bufferError("Buffer media requires an HTTPS public origin with no path.", {
      code: "buffer_public_origin_invalid",
      statusCode: 409
    });
  }
  const prefix = `/${String(mountPath || "").split("/").filter(Boolean).join("/")}`.replace(/^\/$/, "");
  const mediaPath = `${prefix}/api/buffer/media/${encodeURIComponent(token)}/${encodeURIComponent(filename)}`;
  return assertStablePublicVideoUrl(new URL(mediaPath, origin).toString());
}

export {
  BUFFER_GRAPHQL_URL,
  buildBufferMediaUrl,
  bufferMediaGrantMatches,
  createBufferMediaCapability,
  createBufferVideoDraft,
  listBufferChannels
};
