function isLoopbackHost(hostname = "") {
  const value = String(hostname || "").toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "[::1]";
}

function resolveLocalRouteUrl(baseUrl = "", currentUrl = "") {
  const base = new URL(baseUrl);
  try {
    const current = new URL(currentUrl);
    if (!["http:", "https:"].includes(current.protocol) || !isLoopbackHost(current.hostname)) return base.toString();
    return new URL(`${current.pathname || "/"}${current.search || ""}${current.hash || ""}`, base).toString();
  } catch (_error) {
    return base.toString();
  }
}

module.exports = { isLoopbackHost, resolveLocalRouteUrl };
