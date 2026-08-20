const { isLoopbackHost } = require("./local-navigation");

function isVerifiedClipPlaybackUrl(candidateUrl) {
  try {
    const parsed = candidateUrl instanceof URL ? candidateUrl : new URL(String(candidateUrl || ""));
    if (!isLoopbackHost(parsed.hostname) || !["http:", "https:"].includes(parsed.protocol)) return false;
    const pathname = decodeURIComponent(parsed.pathname);
    const candidatePlayback = pathname.includes("/api/") && pathname.endsWith("/playback");
    const renderedOutput = /\/(?:apps\/clipping-office\/)?outputs\/[^/]+\.mp4$/i.test(pathname);
    return candidatePlayback || renderedOutput;
  } catch (_error) {
    return false;
  }
}

module.exports = { isVerifiedClipPlaybackUrl };
