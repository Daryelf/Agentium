const ROBINHOOD_ORIGIN = "https://robinhood.com";
const ROBINHOOD_OAUTH_PATH = "/oauth";
const ROBINHOOD_MCP_RESOURCE = "https://agent.robinhood.com/mcp/trading";
const STOCK_OFFICE_CALLBACK_PATH = "/api/stock-office/robinhood/oauth/callback";

function parsedUrl(value = "") {
  try {
    return new URL(String(value || ""));
  } catch (_error) {
    return null;
  }
}

function isLoopbackHttpUrl(value = "") {
  const url = parsedUrl(value);
  return Boolean(
    url
    && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

function isSafeExternalWebUrl(value = "") {
  const url = parsedUrl(value);
  return Boolean(
    url
    && url.protocol === "https:"
    && !url.username
    && !url.password
    && !isLoopbackHttpUrl(url.toString())
  );
}

function isTrustedRobinhoodOAuthUrl(value = "") {
  const url = parsedUrl(value);
  if (!url || url.origin !== ROBINHOOD_ORIGIN || url.pathname.replace(/\/$/, "") !== ROBINHOOD_OAUTH_PATH) return false;
  if (url.username || url.password || url.hash) return false;
  if (url.searchParams.get("response_type") !== "code") return false;
  if (url.searchParams.get("scope") !== "internal") return false;
  if (url.searchParams.get("resource") !== ROBINHOOD_MCP_RESOURCE) return false;
  if (url.searchParams.get("code_challenge_method") !== "S256") return false;
  if (!url.searchParams.get("client_id") || !url.searchParams.get("state") || !url.searchParams.get("code_challenge")) return false;
  const redirect = parsedUrl(url.searchParams.get("redirect_uri"));
  return Boolean(
    redirect
    && isLoopbackHttpUrl(redirect.toString())
    && redirect.pathname === STOCK_OFFICE_CALLBACK_PATH
    && !redirect.username
    && !redirect.password
    && !redirect.search
    && !redirect.hash
  );
}

module.exports = {
  ROBINHOOD_MCP_RESOURCE,
  isLoopbackHttpUrl,
  isSafeExternalWebUrl,
  isTrustedRobinhoodOAuthUrl,
};
