import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TEXT_BYTES = 120_000;
const MAX_TOOL_OUTPUT_CHARS = 60_000;
const SAFE_SHELL_COMMANDS = new Set(["npm", "node", "npx", "mkdir", "cp", "mv", "ls", "cat", "ffmpeg", "ffprobe"]);
const BLOCKED_PROJECT_SEGMENTS = new Set([".git", "browser-profile", "data", "dist", "node_modules"]);
const RESERVED_OUTPUT_SEGMENTS = new Set([".tmp", "project-edit-proposals"]);
const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])(auth|credential|password|secret|session|token)(?:[-_.]|$)/i,
  /\.(?:key|pem|p12|pfx)$/i
];
const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\b/i,
  /\bcurl\b.+\|\s*(?:bash|sh)\b/i,
  /\bwget\b.+\|\s*(?:bash|sh)\b/i,
  /[;&|`$<>]/,
  /\b(?:ssh|scp|rsync|chmod|chown|killall|pkill|launchctl|osascript)\b/i
];

function now() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value, fallback = "project") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function truncate(value, limit = MAX_TOOL_OUTPUT_CHARS) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function normalizeRelativePath(rawPath, { stripOutputs = false } = {}) {
  let text = cleanText(rawPath).replaceAll("\\", "/");
  if (!text) throw new Error("Path is required.");
  if (stripOutputs) text = text.replace(/^\/?outputs\//i, "");
  if (path.isAbsolute(text)) text = text.replace(/^\/+/, "");
  const normalized = path.posix.normalize(text);
  if (normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Path traversal is not allowed.");
  }
  const firstSegment = normalized.split("/").filter(Boolean)[0]?.toLowerCase() || "";
  if (stripOutputs && RESERVED_OUTPUT_SEGMENTS.has(firstSegment)) throw new Error("This output namespace is reserved for Argentum integrity records.");
  return normalized;
}

function ensureInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("Resolved path is outside the allowed directory.");
  }
  return target;
}

async function assertNoSymlinkTraversal(baseDir, targetPath, { allowMissing = false } = {}) {
  const base = path.resolve(baseDir);
  const target = ensureInside(base, targetPath);
  let cursor = base;
  const relative = path.relative(base, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stats = await fs.lstat(cursor);
      if (stats.isSymbolicLink()) throw new Error("Symbolic links are not allowed in Agent 101 workspace paths.");
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) break;
      throw error;
    }
  }
  return target;
}

function resolveProjectPath(context, rawPath) {
  const projectRoot = path.resolve(context.projectRoot);
  const candidate = path.isAbsolute(cleanText(rawPath))
    ? path.resolve(cleanText(rawPath))
    : path.resolve(projectRoot, normalizeRelativePath(rawPath));
  return ensureInside(projectRoot, candidate);
}

function projectRelativePath(context, absolutePath) {
  return path.relative(path.resolve(context.projectRoot), path.resolve(absolutePath)).replaceAll(path.sep, "/");
}

function projectPathPolicy(context, absolutePath) {
  const relative = projectRelativePath(context, absolutePath);
  const segments = relative.split("/").filter(Boolean);
  const basename = segments.at(-1) || "";
  const blockedIndex = segments.findIndex((segment) => BLOCKED_PROJECT_SEGMENTS.has(segment.toLowerCase()));
  const blockedSegment = blockedIndex >= 0 ? segments[blockedIndex] : "";
  const sensitive = SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(basename)) && !/^\.env\.example$/i.test(basename);
  return {
    relative,
    allowed: !blockedSegment && !sensitive,
    reason: blockedSegment
      ? `The '${blockedSegment}' directory is outside Agent 101's readable workspace.`
      : sensitive
        ? "Credential, authentication, session, token, and environment files are not readable by Agent 101."
        : ""
  };
}

function assertReadableProjectPath(context, absolutePath) {
  const policy = projectPathPolicy(context, absolutePath);
  if (!policy.allowed) throw new Error(policy.reason);
  return policy;
}

function resolveOutputPath(context, rawPath) {
  const outputRoot = path.resolve(context.outputRoot);
  const rel = normalizeRelativePath(rawPath, { stripOutputs: true });
  return {
    absolute: ensureInside(outputRoot, path.resolve(outputRoot, rel)),
    relative: rel,
    publicPath: `outputs/${rel}`
  };
}

function resolveExistingOutputPath(context, rawPath) {
  const outputRoot = path.resolve(context.outputRoot);
  let text = cleanText(rawPath).replaceAll("\\", "/");
  if (path.isAbsolute(text)) {
    return {
      absolute: ensureInside(outputRoot, text),
      relative: path.relative(outputRoot, text).replaceAll(path.sep, "/")
    };
  }
  text = normalizeRelativePath(text, { stripOutputs: true });
  return {
    absolute: ensureInside(outputRoot, path.resolve(outputRoot, text)),
    relative: text
  };
}

async function writeOutputFile(context, rawPath, content, options = {}) {
  const resolved = resolveOutputPath(context, rawPath);
  await assertNoSymlinkTraversal(context.outputRoot, resolved.absolute, { allowMissing: true });
  const existing = await fs.readFile(resolved.absolute).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  const nextHash = crypto.createHash("sha256").update(content).digest("hex");
  if (existing !== null) {
    const existingHash = crypto.createHash("sha256").update(existing).digest("hex");
    if (existingHash === nextHash) {
      context.trustedOutputHashes ||= new Map();
      if (options.trusted === true) context.trustedOutputHashes.set(resolved.publicPath, nextHash);
      const stats = await fs.stat(resolved.absolute);
      return { path: resolved.publicPath, absolutePath: resolved.absolute, bytes: stats.size, unchanged: true };
    }
    const trustedCurrent = options.trustedOverwrite === true && context.trustedOutputHashes?.get(resolved.publicPath) === existingHash;
    if (options.approvedOverwrite !== true && !trustedCurrent) {
      throw new Error(`Refusing to replace existing output '${resolved.publicPath}' without its exact Human Gate overwrite approval.`);
    }
  }
  await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
  const temporary = `${resolved.absolute}.agent101-${crypto.randomBytes(5).toString("hex")}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, resolved.absolute);
  const stats = await fs.stat(resolved.absolute);
  context.trustedOutputHashes ||= new Map();
  if (options.trusted === true) context.trustedOutputHashes.set(resolved.publicPath, nextHash);
  else context.trustedOutputHashes.delete(resolved.publicPath);
  await context.logEvent?.("agent101_output_written", "Agent 101 wrote an output file", {
    path: resolved.publicPath,
    bytes: stats.size
  });
  return { path: resolved.publicPath, absolutePath: resolved.absolute, bytes: stats.size };
}

async function readFileLimited(filePath, maxBytes = MAX_TEXT_BYTES, offsetBytes = 0) {
  const handle = await fs.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const offset = Math.max(0, Math.min(stats.size, Number(offsetBytes) || 0));
    const length = Math.min(Math.max(0, stats.size - offset), Math.max(1, Math.min(MAX_TEXT_BYTES, Number(maxBytes) || MAX_TEXT_BYTES)));
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return {
      content: buffer.toString("utf8"),
      bytesRead: length,
      offsetBytes: offset,
      nextOffsetBytes: offset + length < stats.size ? offset + length : null,
      truncated: offset + length < stats.size,
      sizeBytes: stats.size
    };
  } finally {
    await handle.close();
  }
}

async function searchProjectText(input, context) {
  const query = cleanText(input.query);
  if (query.length < 2) throw new Error("search query must contain at least two characters.");
  const start = resolveProjectPath(context, input.path || ".");
  assertReadableProjectPath(context, start);
  await assertNoSymlinkTraversal(context.projectRoot, start);
  const caseSensitive = input.case_sensitive === true;
  const needle = caseSensitive ? query : query.toLowerCase();
  const maxResults = Math.max(1, Math.min(100, Number(input.max_results || 40)));
  const results = [];
  let filesSearched = 0;

  async function walk(candidate) {
    if (results.length >= maxResults || filesSearched >= 1500) return;
    const policy = projectPathPolicy(context, candidate);
    if (!policy.allowed) return;
    const stats = await fs.lstat(candidate).catch(() => null);
    if (!stats || stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      const entries = await fs.readdir(candidate);
      for (const entry of entries) {
        await walk(path.join(candidate, entry));
        if (results.length >= maxResults) break;
      }
      return;
    }
    if (!stats.isFile() || !fileExtensionAllowedForText(candidate) || stats.size > 2 * 1024 * 1024) return;
    filesSearched += 1;
    const content = await fs.readFile(candidate, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (!haystack.includes(needle)) continue;
      results.push({
        path: projectRelativePath(context, candidate),
        line: index + 1,
        excerpt: lines[index].slice(0, 1000)
      });
    }
  }

  await walk(start);
  return { query, path: projectRelativePath(context, start) || ".", files_searched: filesSearched, matches: results, truncated: results.length >= maxResults };
}

function fileExtensionAllowedForText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ![".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov", ".zip", ".pdf", ".icns"].includes(ext);
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Unclosed quote in command.");
  if (current) tokens.push(current);
  return tokens;
}

function validateShellCommand(command) {
  const raw = cleanText(command);
  if (!raw) throw new Error("command is required.");
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(raw)) throw new Error("Shell command is blocked by Agent 101 safety policy.");
  }
  const tokens = tokenizeCommand(raw);
  const commandName = tokens[0];
  if (!SAFE_SHELL_COMMANDS.has(commandName)) {
    throw new Error(`Command '${commandName}' is not allowed.`);
  }
  if (commandName === "npm" && !["install", "run"].includes(tokens[1])) {
    throw new Error("Only 'npm install' and 'npm run' are allowed.");
  }
  if (commandName === "npx" && tokens.some((token) => /^-/.test(token))) {
    throw new Error("npx flags are blocked. Add a project script and request approval instead.");
  }
  if (commandName === "node" && ["-e", "--eval", "-p", "--print"].some((flag) => tokens.includes(flag))) {
    throw new Error("Inline Node evaluation is blocked. Add a reviewed project script and request Human Gate approval for that exact file-backed command.");
  }
  return { commandName, args: tokens.slice(1), raw };
}

function approvalFor(context, approvalId, expectedActionType = "") {
  if (!approvalId) return null;
  const approval = (context.state?.approvalRequests || []).find((item) => item.id === approvalId) || null;
  if (approval?.expiresAt && !Number.isNaN(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) <= Date.now()) return null;
  if (!approval || approval.status !== "approved" || (expectedActionType && approval.actionType !== expectedActionType)) return null;
  if (approval.consumedAt || Number(approval.useCount || 0) >= 1) return null;
  if (context.missionId) {
    if (approval.missionId !== context.missionId) return null;
  } else {
    const approvalSessionId = approval.evidence?.sessionId || approval.sessionId || "";
    if (!approvalSessionId || approvalSessionId !== context.sessionId) return null;
  }
  return approval;
}

function approvalDetails(approval) {
  return approval?.grantedDetails || approval?.details || approval?.evidence?.details || {};
}

function scopeMatches(approval, expected = {}) {
  const details = approvalDetails(approval);
  return Object.entries(expected).every(([key, value]) => cleanText(details[key]) === cleanText(value));
}

async function consumeApproval(context, approval, actionType, details) {
  if (!approval) throw new Error("Human Gate approval is missing, expired, already used, or outside this mission.");
  if (typeof context.consumeApproval === "function") {
    return context.consumeApproval({ approvalId: approval.id, actionType, details });
  }
  if (approval.consumedAt || Number(approval.useCount || 0) >= 1) throw new Error("Human Gate approval has already been used.");
  approval.useCount = Number(approval.useCount || 0) + 1;
  approval.consumedAt = now();
  approval.consumedByRunId = context.runId || null;
  await context.saveState?.();
  return approval;
}

function safeChildEnvironment() {
  const allowed = ["HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH", "SHELL", "TMPDIR", "USER"];
  return Object.fromEntries(allowed.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

function redactSensitiveOutput(value) {
  return String(value || "")
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\bsk-(?:proj|ant|svcacct)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|whsec_[A-Za-z0-9_-]{16,}|SK[0-9a-fA-F]{32})\b/g, "[REDACTED_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer [REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)\s*=\s*([^\s]+)/g, "$1=[REDACTED]");
}

async function requestApproval(context, { action, reason, risk_level: riskLevel = "medium", details = {}, linkedId = "", actionType = "agent101_advisory", minimumRisk = "medium" }) {
  const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const fixedRisk = riskOrder[riskLevel] >= riskOrder[minimumRisk] ? riskLevel : minimumRisk;
  const request = context.createApprovalRequest?.({
    type: actionType,
    actionType,
    title: action.slice(0, 120),
    riskLevel: fixedRisk,
    linkedId: linkedId || context.runId || crypto.randomUUID(),
    evidence: {
      reason,
      details,
      sessionId: context.sessionId || "",
      runId: context.runId || ""
    },
    createdBy: "agent101"
  });
  await context.saveState?.();
  return { approval_id: request?.id || "", status: request?.status || "pending" };
}

function inferBusinessName(message, fallback = "New Business") {
  const text = cleanText(message);
  const called = text.match(/\bcalled\s+([A-Z][A-Za-z0-9 '&-]{1,60})/);
  if (called) return called[1].replace(/[.?!].*$/, "").trim();
  const forMy = text.match(/\bfor\s+(?:my\s+)?(?:a\s+)?([A-Za-z0-9 '&-]{3,60})(?:\s+(?:business|shop|brand|company|site|website))?/i);
  if (forMy) return forMy[1].replace(/[.?!].*$/, "").trim();
  return fallback;
}

function premiumLandingCopy(name, description, type) {
  const business = cleanText(name) || "Argentum Build";
  const desc = cleanText(description) || "a modern operator-led business";
  const typeLabel = cleanText(type) || "business";
  return {
    heroTitle: `${business} turns custom ideas into finished work.`,
    heroLead: `A premium ${typeLabel} experience for customers who want clarity, speed, and production quality without messy back-and-forth.`,
    proof: [
      "Fast intake, clear pricing, and clean order handoff.",
      "Mobile-first customer flow built for conversion.",
      "Server-side integrations with secrets kept out of the browser."
    ],
    cta: "Start an order"
  };
}

function baseCss() {
  return `:root {
  --bg: #071015;
  --panel: #0f1b24;
  --ink: #f6fbff;
  --muted: #9db0bf;
  --line: rgba(139, 219, 255, 0.18);
  --brand: #37d7c2;
  --accent: #4d8dff;
  --warn: #ffc04d;
  --radius: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(circle at top right, rgba(77, 141, 255, 0.18), transparent 32rem), var(--bg);
  color: var(--ink);
}
a { color: inherit; text-decoration: none; }
.shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; }
.nav { display: flex; align-items: center; justify-content: space-between; padding: 18px 0; border-bottom: 1px solid var(--line); }
.brand { display: flex; gap: 12px; align-items: center; font-weight: 900; letter-spacing: .04em; }
.mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--radius); background: linear-gradient(135deg, var(--brand), var(--accent)); color: #031015; }
.nav-links { display: flex; gap: 14px; color: var(--muted); font-size: 14px; }
.hero { min-height: 68vh; display: grid; align-items: center; padding: 56px 0; }
.hero-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 30px; align-items: center; }
.eyebrow { color: var(--brand); font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
h1 { font-size: clamp(44px, 7vw, 88px); line-height: .94; margin: 12px 0 18px; letter-spacing: 0; }
.lead { color: #bfd0dc; font-size: clamp(18px, 2vw, 23px); line-height: 1.5; max-width: 680px; }
.actions { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
.button { border: 1px solid var(--line); border-radius: var(--radius); padding: 13px 18px; font-weight: 800; background: #0b1720; }
.button.primary { background: linear-gradient(135deg, var(--brand), var(--accent)); color: #031015; border: 0; }
.visual { aspect-ratio: 4 / 3; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(145deg, rgba(55,215,194,.22), rgba(77,141,255,.12)), #08141d; padding: 18px; display: grid; align-content: end; box-shadow: 0 30px 80px rgba(0,0,0,.28); }
.visual-card { border: 1px solid var(--line); border-radius: var(--radius); background: rgba(5, 13, 20, .78); padding: 18px; }
.section { padding: 54px 0; border-top: 1px solid var(--line); }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.card { border: 1px solid var(--line); border-radius: var(--radius); background: rgba(15, 27, 36, .78); padding: 20px; }
.card h3 { margin: 0 0 8px; }
.card p, .muted { color: var(--muted); line-height: 1.55; }
.products { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.product { border: 1px solid var(--line); border-radius: var(--radius); background: #0b1720; overflow: hidden; }
.product-media { aspect-ratio: 4 / 3; background: linear-gradient(135deg, rgba(55,215,194,.2), rgba(255,192,77,.14)); display: grid; place-items: center; color: var(--brand); font-weight: 900; }
.product-body { padding: 16px; }
.price { color: var(--brand); font-weight: 900; }
.footer { padding: 36px 0; color: var(--muted); border-top: 1px solid var(--line); }
form { display: grid; gap: 10px; }
input, textarea, select { width: 100%; border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; background: #07131b; color: var(--ink); font: inherit; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 12px; color: var(--muted); }
@media (max-width: 760px) {
  .hero-grid, .cards { grid-template-columns: 1fr; }
  .nav { align-items: flex-start; gap: 12px; }
  .nav-links { flex-wrap: wrap; justify-content: flex-end; }
}`;
}

function clientJs() {
  return `const cart = JSON.parse(localStorage.getItem("cart") || "[]");
function saveCart() { localStorage.setItem("cart", JSON.stringify(cart)); }
function addToCart(id) {
  const item = cart.find((entry) => entry.id === id);
  if (item) item.quantity += 1;
  else cart.push({ id, quantity: 1 });
  saveCart();
  alert("Added to cart");
}
async function checkout() {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: cart })
  });
  const data = await response.json();
  if (data.url) window.location.href = data.url;
  else alert(data.error || "Checkout is not configured yet.");
}
window.addToCart = addToCart;
window.checkout = checkout;`;
}

async function scaffoldWebsite(input, context) {
  const name = cleanText(input.name) || inferBusinessName(input.description, "Argentum Site");
  const type = cleanText(input.type || "landing").toLowerCase();
  const slug = slugify(name);
  const baseRoot = `websites/${slug}`;
  let root = baseRoot;
  let suffix = 1;
  while (await fs.stat(resolveOutputPath(context, root).absolute).then(() => true).catch(() => false)) {
    suffix += 1;
    root = `${baseRoot}-v${suffix}`;
  }
  const copy = premiumLandingCopy(name, input.description, type);
  const htmlName = escapeHtml(name);
  const htmlInitials = escapeHtml(name.slice(0, 2).toUpperCase());
  const htmlType = escapeHtml(type);
  const htmlCopy = Object.fromEntries(Object.entries(copy).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map(escapeHtml) : escapeHtml(value)
  ]));
  const pages = Array.isArray(input.pages) && input.pages.length ? input.pages : ["Home", type === "shop" ? "Products" : "Services", "About", "Contact"];
  const features = Array.isArray(input.features) ? input.features : [];
  const products = [
    { id: "starter", name: "Starter Build", description: "A polished entry offer with clear specs and fast delivery.", price_cents: 4900, currency: "usd" },
    { id: "pro", name: "Pro Build", description: "Custom detail, premium finish, and operator review before delivery.", price_cents: 12900, currency: "usd" },
    { id: "studio", name: "Studio Retainer", description: "Repeat production support for teams with ongoing demand.", price_cents: 29900, currency: "usd" }
  ];
  const pageCards = pages.map((page) => `<article class="card"><h3>${escapeHtml(page)}</h3><p>${htmlCopy.proof[pages.indexOf(page) % htmlCopy.proof.length]}</p></article>`).join("\n          ");
  const productCards = products.map((product) => `
        <article class="product">
          <div class="product-media">${escapeHtml(product.name.split(" ")[0])}</div>
          <div class="product-body">
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description)}</p>
            <p class="price">$${(product.price_cents / 100).toFixed(2)}</p>
            <button class="button primary" onclick="addToCart('${escapeHtml(product.id)}')">Add to cart</button>
          </div>
        </article>`).join("\n");
  const files = [];
  const write = async (rel, content) => files.push(await writeOutputFile(context, `${root}/${rel}`, content, { trusted: true }));

  await write("package.json", JSON.stringify({
    name: slug,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { start: "node server.js" },
    dependencies: { "@stripe/stripe-js": "^7.0.0", "stripe": "^18.0.0" }
  }, null, 2));
  await write(".env.example", "PORT=3000\nADMIN_TOKEN=\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\nPUBLIC_BASE_URL=http://127.0.0.1:3000\nEMAIL_SEND_ENABLED=false\nEMAIL_FROM=\nRESEND_API_KEY=\nSENDGRID_API_KEY=\n");
  await write("data/products.json", JSON.stringify(products, null, 2));
  await write("public/styles.css", baseCss());
  await write("public/app.js", clientJs());
  await write("public/index.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlName}</title>
  <meta name="description" content="${htmlCopy.heroLead}">
  <link rel="stylesheet" href="/styles.css">
  <script defer src="/app.js"></script>
</head>
<body>
  <header class="shell nav">
    <a class="brand" href="/"><span class="mark">${htmlInitials}</span>${htmlName}</a>
    <nav class="nav-links"><a href="/products.html">Products</a><a href="/about.html">About</a><a href="/contact.html">Contact</a><a href="/admin.html">Admin</a></nav>
  </header>
  <main>
    <section class="shell hero">
      <div class="hero-grid">
        <div>
          <span class="eyebrow">${htmlType} system</span>
          <h1>${htmlCopy.heroTitle}</h1>
          <p class="lead">${htmlCopy.heroLead}</p>
          <div class="actions"><a class="button primary" href="${type === "shop" ? "/products.html" : "/contact.html"}">${htmlCopy.cta}</a><a class="button" href="/about.html">See how it works</a></div>
        </div>
        <div class="visual"><div class="visual-card"><span class="eyebrow">Live offer</span><h2>${htmlName}</h2><p class="muted">${features.length ? features.slice(0, 3).map(escapeHtml).join(" / ") : "Custom orders / clear pricing / premium delivery"}</p></div></div>
      </div>
    </section>
    <section class="shell section"><span class="eyebrow">Operating model</span><h2>Built for buyers who want the process handled.</h2><div class="cards">${pageCards}</div></section>
  </main>
  <footer class="shell footer">Built by Agent 101 inside Argentum OS. Replace placeholder copy, prices, and product media before launch.</footer>
</body>
</html>`);
  await write("public/products.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlName} Products</title><link rel="stylesheet" href="/styles.css"><script defer src="/app.js"></script></head><body><header class="shell nav"><a class="brand" href="/"><span class="mark">${htmlInitials}</span>${htmlName}</a><nav class="nav-links"><a href="/">Home</a><a href="/cart.html">Cart</a></nav></header><main class="shell section"><span class="eyebrow">Products</span><h1>Choose the right build.</h1><div class="products">${productCards}</div></main></body></html>`);
  await write("public/product.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Product Detail - ${htmlName}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><a class="button" href="/products.html">Back</a><h1>Custom order detail</h1><p class="lead">Use this page to describe material, dimensions, lead time, and customer-upload requirements.</p></main></body></html>`);
  await write("public/cart.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cart - ${htmlName}</title><link rel="stylesheet" href="/styles.css"><script defer src="/app.js"></script></head><body><main class="shell section"><h1>Cart</h1><p class="lead">Checkout redirects to Stripe once STRIPE_SECRET_KEY is configured server-side.</p><button class="button primary" onclick="checkout()">Checkout with Stripe</button></main></body></html>`);
  await write("public/success.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout return received</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><h1>Checkout return received.</h1><p class="lead">Payment and order status are not confirmed by this page. The signed Stripe webhook and protected order record remain the source of truth.</p></main></body></html>`);
  await write("public/cancel.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout cancelled</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><h1>Checkout cancelled.</h1><a class="button primary" href="/cart.html">Return to cart</a></main></body></html>`);
  await write("public/about.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About ${htmlName}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><span class="eyebrow">About</span><h1>${htmlName} is built for quality-first execution.</h1><p class="lead">${htmlCopy.heroLead}</p></main></body></html>`);
  await write("public/contact.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contact ${htmlName}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><span class="eyebrow">Start</span><h1>Send your project details.</h1><form><input placeholder="Name"><input placeholder="Email"><textarea rows="6" placeholder="What do you need built?"></textarea><button class="button primary" type="button">Save request locally</button></form></main></body></html>`);
  await write("public/admin.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin - ${htmlName}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell section"><span class="eyebrow">Protected admin dashboard</span><h1>Orders</h1><form id="admin-login"><label>Admin token<input id="admin-token" type="password" autocomplete="current-password" required></label><button class="button primary">Load orders</button></form><p class="muted" id="admin-status">The token stays in this browser tab and is sent only to the protected order API.</p><table><thead><tr><th>Order</th><th>Status</th><th>Total</th></tr></thead><tbody id="orders"><tr><td colspan="3">Authenticate to load orders.</td></tr></tbody></table></main><script>document.querySelector('#admin-login').addEventListener('submit', async (event) => { event.preventDefault(); const token = document.querySelector('#admin-token').value; sessionStorage.setItem('adminToken', token); const response = await fetch('/api/admin/orders', { headers: { authorization: 'Bearer ' + token } }); const data = await response.json(); if (!response.ok) { document.querySelector('#admin-status').textContent = data.error || 'Authentication failed.'; return; } const orders = Array.isArray(data.orders) ? data.orders : []; document.querySelector('#admin-status').textContent = orders.length + ' order(s) loaded.'; const tbody = document.querySelector('#orders'); tbody.replaceChildren(); const rows = orders.length ? orders : [{ id: 'No paid orders yet.', fulfillmentStatus: '', amountTotal: null, currency: 'usd' }]; for (const order of rows) { const row = document.createElement('tr'); const total = order.amountTotal === null ? '' : (Number(order.amountTotal || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: String(order.currency || 'usd').toUpperCase() }); for (const value of [order.id, order.fulfillmentStatus, total]) { const cell = document.createElement('td'); cell.textContent = String(value || ''); row.append(cell); } tbody.append(row); } });</script></body></html>`);
  await write("server.js", `import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const products = JSON.parse(await fs.readFile(path.join(__dirname, "data/products.json"), "utf8"));
const port = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function adminAuthorized(req) {
  const expected = String(process.env.ADMIN_TOKEN || "");
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!expected || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

async function readJson(req) {
  const rawBody = await readBody(req);
  if (!rawBody.length) return {};
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/products") return sendJson(res, 200, { products });
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      const payload = await readJson(req);
      if (!process.env.STRIPE_SECRET_KEY) return sendJson(res, 400, { error: "STRIPE_SECRET_KEY is not configured." });
      const { createCheckoutSession } = await import("./server/stripe-checkout.js");
      const baseUrl = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:" + port;
      const session = await createCheckoutSession({ items: payload.items || [], baseUrl });
      return sendJson(res, 200, { id: session.id, url: session.url });
    }
    if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
      const rawBody = await readBody(req);
      const signature = req.headers["stripe-signature"] || "";
      const { handleStripeWebhook } = await import("./server/stripe-webhook.js");
      return sendJson(res, 200, await handleStripeWebhook(rawBody, signature));
    }
    if (req.method === "GET" && url.pathname === "/api/admin/orders") {
      if (!process.env.ADMIN_TOKEN) return sendJson(res, 503, { error: "ADMIN_TOKEN is not configured." });
      if (!adminAuthorized(req)) return sendJson(res, 401, { error: "Admin authentication required." });
      const { listOrders } = await import("./server/order-store.js");
      return sendJson(res, 200, { orders: await listOrders() });
    }
    const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.resolve(publicDir, \`.\${safePath}\`);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      const error = new Error("Forbidden");
      error.statusCode = 403;
      throw error;
    }
    const data = await fs.readFile(filePath);
    const type = filePath.endsWith(".css") ? "text/css" : filePath.endsWith(".js") ? "text/javascript" : "text/html";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch (error) {
    const status = Number(error.statusCode) || (error.code === "ENOENT" ? 404 : 500);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Internal server error." : error.message });
    else res.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(${JSON.stringify(name)} + " running at http://127.0.0.1:" + port);
});`);
  await write("README.md", `# ${name}

Generated by Agent 101 in Argentum OS.

## Run locally

\`\`\`bash
npm install
cp .env.example .env
npm start
\`\`\`

Open http://127.0.0.1:3000.

## Operator setup

- Replace placeholder copy, product details, and media with real business assets.
- Add Stripe keys to environment variables only. Never place live keys in frontend files.
- Set a long random \`ADMIN_TOKEN\` server-side before using the order dashboard.
- Test checkout with Stripe test card 4242 4242 4242 4242 after adding the test keys and webhook secret.
`);

  return {
    scaffolded: true,
    name,
    type,
    path: `outputs/${root}`,
    files_created: files.map((file) => file.path),
    manifest: {
      pages,
      features,
      products: type === "shop" ? products.length : 0,
      setup_required: type === "shop" ? ["Add Stripe keys to .env", "Run npm install inside the generated site", "Replace placeholder product media"] : ["Replace placeholder copy and media"]
    }
  };
}

async function addStripeCheckout(input, context) {
  const website = resolveExistingOutputPath(context, input.website_path || "websites/site");
  const products = (Array.isArray(input.products) && input.products.length ? input.products : [
    { name: "Custom Order", description: "Custom product order", price_cents: 4900, currency: "usd" }
  ]).map((product, index) => ({ ...product, id: cleanText(product.id) || slugify(product.name, `product-${index + 1}`) }));
  const rootRel = website.relative;
  const files = [];
  const write = async (rel, content) => files.push(await writeOutputFile(context, `${rootRel}/${rel}`, content, { trusted: true, trustedOverwrite: true }));
  await write("config/stripe.js", `import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("STRIPE_SECRET_KEY is not configured. Checkout stays disabled.");
}

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
`);
  await write("server/stripe-checkout.js", `import { stripe } from "../config/stripe.js";

export async function createCheckoutSession({ items = [], baseUrl }) {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");
  const products = ${JSON.stringify(products, null, 2)};
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error("Checkout requires between 1 and 20 valid items.");
  const line_items = items.map((item) => {
    const product = products.find((entry) => entry.id === item.id);
    if (!product) throw new Error("Checkout contains an unknown product.");
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Product quantity must be an integer from 1 to 20.");
    return {
      quantity,
      price_data: {
        currency: product.currency || "usd",
        product_data: { name: product.name, description: product.description },
        unit_amount: Number(product.price_cents || 0)
      }
    };
  });
  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    success_url: \`\${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}\`,
    cancel_url: \`\${baseUrl}/cancel.html\`
  });
}
`);
  await write("data/orders.json", "[]\n");
  await write("server/order-store.js", `import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordersPath = path.join(__dirname, "..", "data", "orders.json");
let writeQueue = Promise.resolve();

async function readOrders() {
  return JSON.parse(await fs.readFile(ordersPath, "utf8").catch(() => "[]"));
}

export async function listOrders() {
  return readOrders();
}

export async function recordCheckoutOrder(session, eventId) {
  let result = null;
  writeQueue = writeQueue.then(async () => {
    const orders = await readOrders();
    const existing = orders.find((order) => order.eventId === eventId || order.checkoutSessionId === session.id);
    if (existing) {
      result = { order: existing, created: false };
      return;
    }
    const saved = {
      id: session.payment_intent || session.id,
      checkoutSessionId: session.id,
      eventId,
      customerEmail: session.customer_details?.email || session.customer_email || "",
      amountTotal: session.amount_total || 0,
      currency: session.currency || "usd",
      paymentStatus: session.payment_status || "paid",
      fulfillmentStatus: "new",
      createdAt: new Date().toISOString()
    };
    orders.unshift(saved);
    const temporary = ordersPath + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(orders, null, 2) + "\\n");
    await fs.rename(temporary, ordersPath);
    result = { order: saved, created: true };
  });
  await writeQueue;
  return result;
}
`);
  await write("server/stripe-webhook.js", `import { stripe, stripeWebhookSecret } from "../config/stripe.js";
import { recordCheckoutOrder } from "./order-store.js";

export async function handleStripeWebhook(rawBody, signature) {
  if (!stripe || !stripeWebhookSecret) throw new Error("Stripe webhook secret is not configured.");
  const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  if (event.type === "checkout.session.completed") {
    const { order, created } = await recordCheckoutOrder(event.data.object, event.id);
    return { received: true, action: created ? "order_recorded" : "duplicate_ignored", eventId: event.id, orderId: order.id, created };
  }
  if (event.type === "payment_intent.succeeded") {
    return { received: true, action: "payment_confirmed", eventId: event.id };
  }
  return { received: true, ignored: true, eventId: event.id };
}
`);
  await write("STRIPE_SETUP.md", `# Stripe Checkout Setup

1. Create a Stripe account at https://stripe.com.
2. Open Developers -> API keys.
3. Copy the test secret key into your server environment as \`STRIPE_SECRET_KEY\`.
4. Create a webhook endpoint pointing to your deployed \`/api/stripe/webhook\`.
5. Copy the webhook signing secret into \`STRIPE_WEBHOOK_SECRET\`.
6. Test with card \`4242 4242 4242 4242\`, any future date, any CVC.

Never paste live Stripe keys into frontend files or Git.
`);
  return {
    integrated: true,
    checkout_route: "/api/checkout",
    webhook_route: "/api/stripe/webhook",
    orders_route: "/api/admin/orders",
    website_path: `outputs/${rootRel}`,
    files_created: files.map((file) => file.path),
    setup_required: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "Stripe webhook endpoint"]
  };
}

async function addEmailFlow(input, context) {
  const website = resolveExistingOutputPath(context, input.website_path || "websites/site");
  const provider = cleanText(input.provider || "resend").toLowerCase();
  if (!["resend", "sendgrid"].includes(provider)) throw new Error("Email provider must be resend or sendgrid.");
  const allowedEvents = new Set(["order_confirmation", "shipping_update", "abandoned_cart", "welcome", "password_reset"]);
  const events = (Array.isArray(input.events) && input.events.length ? input.events : ["order_confirmation", "shipping_update"])
    .map((eventName) => cleanText(eventName).toLowerCase())
    .filter((eventName, index, all) => allowedEvents.has(eventName) && all.indexOf(eventName) === index);
  if (!events.length) throw new Error("At least one supported email event is required.");
  const rootRel = website.relative;
  const files = [];
  const write = async (rel, content, options = { trusted: true, trustedOverwrite: true }) => files.push(await writeOutputFile(context, `${rootRel}/${rel}`, content, options));
  for (const eventName of events) {
    const title = eventName.replaceAll("_", " ");
    await write(`emails/${eventName}.html`, `<main style="font-family:Arial,sans-serif;line-height:1.5;color:#111"><h1>${title}</h1><p>Hi {{customer_name}},</p><p>This message confirms ${title} for order {{order_id}}.</p><p>Reply to this email if anything looks wrong.</p></main>`);
    await write(`emails/${eventName}.txt`, `${title}\n\nHi {{customer_name}},\n\nThis message confirms ${title} for order {{order_id}}.\n\nReply to this email if anything looks wrong.\n`);
  }
  await write("server/email.js", `import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provider = "${provider}";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function renderTemplate(eventName, data = {}) {
  const templatePath = path.join(__dirname, "..", "emails", \`\${eventName}.html\`);
  let html = await fs.readFile(templatePath, "utf8");
  for (const [key, value] of Object.entries(data)) html = html.replaceAll(\`{{\${key}}}\`, escapeHtml(value));
  return html;
}

export async function sendEventEmail(eventName, { to, subject, data }) {
  if (!to) throw new Error("Email recipient is required.");
  const html = await renderTemplate(eventName, data);
  if (process.env.EMAIL_SEND_ENABLED !== "true") {
    return { sent: false, provider, to, subject, html, approval_required: true, setup_required: "Set EMAIL_SEND_ENABLED=true only after Human Gate approves customer email sending." };
  }
  if (!process.env.EMAIL_FROM) throw new Error("EMAIL_FROM is not configured.");
  if (provider === "resend" && !process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");
  if (provider === "sendgrid" && !process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY is not configured.");
  if (provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: \`Bearer \${process.env.RESEND_API_KEY}\`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Resend email failed.");
    return { sent: true, provider, messageId: payload.id };
  }
  if (provider === "sendgrid") {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: \`Bearer \${process.env.SENDGRID_API_KEY}\`, "content-type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: process.env.EMAIL_FROM }, subject, content: [{ type: "text/html", value: html }] })
    });
    if (!response.ok) throw new Error((await response.text()) || "SendGrid email failed.");
    return { sent: true, provider, messageId: response.headers.get("x-message-id") || "accepted" };
  }
  throw new Error(\`Provider '\${provider}' is not wired for live sending.\`);
}
`);
  const webhookPath = path.join(website.absolute, "server", "stripe-webhook.js");
  const webhookSource = await fs.readFile(webhookPath, "utf8").catch(() => "");
  const webhookPublicPath = `outputs/${rootRel}/server/stripe-webhook.js`;
  const webhookWasTrusted = context.trustedOutputHashes?.get(webhookPublicPath) === crypto.createHash("sha256").update(webhookSource).digest("hex");
  if (events.includes("order_confirmation") && webhookSource.includes("recordCheckoutOrder")) {
    let wiredWebhook = webhookSource;
    if (!wiredWebhook.includes('from "./email.js"')) {
      wiredWebhook = wiredWebhook.replace(
        'import { recordCheckoutOrder } from "./order-store.js";',
        'import { recordCheckoutOrder } from "./order-store.js";\nimport { sendEventEmail } from "./email.js";'
      );
    }
    wiredWebhook = wiredWebhook.replace(
      '    return { received: true, action: created ? "order_recorded" : "duplicate_ignored", eventId: event.id, orderId: order.id, created };',
      `    if (created && process.env.EMAIL_SEND_ENABLED === "true" && order.customerEmail) {
      await sendEventEmail("order_confirmation", {
        to: order.customerEmail,
        subject: "Order confirmation " + order.id,
        data: { customer_name: order.customerEmail, order_id: order.id }
      });
    }
    return { received: true, action: created ? "order_recorded" : "duplicate_ignored", eventId: event.id, orderId: order.id, created, emailEnabled: created && process.env.EMAIL_SEND_ENABLED === "true" };`
    );
    await write("server/stripe-webhook.js", wiredWebhook, { trusted: webhookWasTrusted, trustedOverwrite: webhookWasTrusted });
  }
  await write("EMAIL_SETUP.md", `# Email Flow Setup

Provider selected: ${provider}

Events generated:
${events.map((eventName) => `- ${eventName}`).join("\n")}

Set the provider key in server environment variables only:

- Resend: \`RESEND_API_KEY\`
- SendGrid: \`SENDGRID_API_KEY\`
- Sender address: \`EMAIL_FROM\`
- Human-approved live switch: \`EMAIL_SEND_ENABLED=true\`

The generated sending module refuses to send until the provider key and explicit live switch exist server-side.
`);
  return { integrated: true, provider, events, files_created: files.map((file) => file.path) };
}

async function generateDeploymentConfig(input, context) {
  const website = resolveExistingOutputPath(context, input.website_path || "websites/site");
  const platform = cleanText(input.platform || "railway").toLowerCase();
  const rootRel = website.relative;
  const files = [];
  const write = async (rel, content) => files.push(await writeOutputFile(context, `${rootRel}/${rel}`, content));
  if (platform === "railway") {
    await write("railway.json", JSON.stringify({ build: { builder: "NIXPACKS" }, deploy: { startCommand: "npm start", restartPolicyType: "ON_FAILURE" } }, null, 2));
    await write("Procfile", "web: npm start\n");
    await write("RAILWAY_ENV_CHECKLIST.md", "# Railway Environment Variables\n\n- PORT\n- STRIPE_SECRET_KEY\n- STRIPE_WEBHOOK_SECRET\n- RESEND_API_KEY or SENDGRID_API_KEY\n");
  } else if (platform === "vercel") {
    await write("vercel.json", JSON.stringify({ version: 2, builds: [{ src: "server.js", use: "@vercel/node" }], routes: [{ src: "/(.*)", dest: "server.js" }] }, null, 2));
  } else if (platform === "vps_nginx") {
    await write("deploy/nginx.conf", "server {\n  listen 80;\n  server_name example.com;\n  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }\n}\n");
    await write("deploy/argentum-site.service", "[Unit]\nDescription=Generated Argentum website\nAfter=network.target\n\n[Service]\nWorkingDirectory=/var/www/argentum-site\nExecStart=/usr/bin/npm start\nRestart=always\nEnvironment=PORT=3000\n\n[Install]\nWantedBy=multi-user.target\n");
    await write("deploy/deploy.sh", "#!/usr/bin/env bash\nset -euo pipefail\nnpm install\nsudo systemctl restart argentum-site\n");
  } else {
    await write(`${platform}-deploy-notes.md`, `# ${platform} deployment\n\nUse \`npm install\` then \`npm start\`. Add provider keys only in the host environment manager.\n`);
  }
  return { platform, files_created: files.map((file) => file.path) };
}

async function claudeCopy(input, context) {
  if (!context.anthropicClient) return null;
  const { approval_id: _approvalId, ...providerInput } = input;
  const serializedInput = JSON.stringify(providerInput);
  const inputHash = crypto.createHash("sha256").update(serializedInput).digest("hex");
  const approvalScope = { provider: "anthropic", purpose: "write_copy", inputHash };
  const approved = approvalFor(context, input.approval_id, "agent101_paid_copy");
  if (!approved || !scopeMatches(approved, approvalScope)) {
    const request = await requestApproval(context, {
      action: "Generate copy with the configured Anthropic provider",
      reason: "Provider-generated copy is a paid external API call and requires approval for this exact input hash.",
      risk_level: "medium",
      minimumRisk: "medium",
      actionType: "agent101_paid_copy",
      details: approvalScope,
      linkedId: `agent101_paid_copy:${context.runId}:${inputHash}`
    });
    return { requiresApproval: true, ...request, provider: "anthropic", input_hash: inputHash };
  }
  let reservationId = "";
  try {
    reservationId = await context.beforeModelCall?.({
      provider: "anthropic",
      model: context.config.anthropicModel,
      estimatedInputTokens: Math.max(256, Math.ceil(serializedInput.length / 4)),
      maxOutputTokens: 1200
    }) || "";
    await consumeApproval(context, approved, "agent101_paid_copy", approvalScope);
    const response = await context.anthropicClient.messages.create({
      model: context.config.anthropicModel,
      max_tokens: 1200,
      system: "Write premium, specific business copy. No filler. Return only the requested copy.",
      messages: [{ role: "user", content: JSON.stringify(providerInput, null, 2) }]
    }, {
      signal: AbortSignal.timeout(Math.max(1000, Number(context.config.agent101ProviderTimeoutMs || 120_000))),
      timeout: Math.max(1000, Number(context.config.agent101ProviderTimeoutMs || 120_000))
    });
    await context.recordUsage?.("anthropic", response.usage || {}, null, reservationId);
    return response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
  } catch (error) {
    await context.providerCallFailed?.(reservationId, error);
    throw error;
  }
}

async function writeCopy(input, context) {
  const generated = await claudeCopy(input, context);
  if (generated?.requiresApproval) return generated;
  if (generated) return { content: generated, provider: "claude", model: context.config.anthropicModel };
  const business = input.business || {};
  const name = business.name || business.business_name || "the brand";
  const tone = cleanText(input.tone || "premium and direct");
  const content = `${name}: ${cleanText(input.type || "brand copy")}\n\nA ${tone} message for customers who want a serious result without confusion. The offer is clear, the process is guided, and every next step is designed to reduce friction from first click to finished delivery.\n\nAdd ANTHROPIC_API_KEY for Claude-generated long-form copy.`;
  return { content, provider: "local_copy_engine", setup_note: "ANTHROPIC_API_KEY is not configured." };
}

async function generateBrandIdentity(input, context) {
  const base = slugify(input.business_description || input.industry || "brand", "brand");
  const names = [
    `${base.split("-")[0][0]?.toUpperCase() || "A"}${base.split("-")[0]?.slice(1) || "Forge"} Studio`,
    `${input.industry || "Operator"} Works`,
    `${input.vibe || "Prime"} House`
  ];
  const doc = `# Brand Identity

## Ranked Names
1. ${names[0]} - strongest for premium positioning
2. ${names[1]} - direct category clarity
3. ${names[2]} - flexible lifestyle name

## Taglines
- Built clean. Delivered fast.
- Custom work without the chaos.
- Premium output, operator-grade process.

## Voice
Confident, concrete, and calm. Avoid hype. Lead with proof, process, and delivery quality.

## Palette
- Deep Night: #071015
- Signal Cyan: #37d7c2
- Trust Blue: #4d8dff
- Warm Proof: #ffc04d

## Fonts
Use Inter for product UI and marketing pages. Pair with Space Grotesk for display headings when the brand needs more technical edge.

## Logo Concept
A compact geometric mark built from a forward arrow and a precision frame. It should work as a one-color app icon and a small social avatar.

## Social Bio
${names[0]} builds premium custom work with clear intake, fast execution, and polished delivery.`;
  const written = await writeOutputFile(context, `brand/${base}/brand-identity.md`, doc);
  return { brand_identity: doc, files_created: [written.path], names };
}

async function writeProductListings(input, context) {
  const products = Array.isArray(input.products) ? input.products : [];
  const listings = products.map((product) => ({
    title: `${product.name} - Custom ${product.material || "Premium"} Build`,
    description: `${product.name} is designed for ${product.use_case || "daily use"} with a clean finish and clear production notes.`,
    bullets: [
      `Material: ${product.material || "Confirm before production"}`,
      `Use case: ${product.use_case || "Custom order"}`,
      `Dimensions: ${product.dimensions || "Made to order"}`,
      "Produced with operator review before delivery"
    ],
    tags: [slugify(product.material || "custom"), slugify(product.use_case || "made-to-order"), "premium"],
    seo_meta_description: `Order ${product.name} with clear specs, premium finish, and guided production.`
  }));
  const slug = slugify(input.platform || "website", "website");
  const json = await writeOutputFile(context, `products/${slug}/product-listings.json`, JSON.stringify(listings, null, 2));
  const md = await writeOutputFile(context, `products/${slug}/product-listings.md`, listings.map((listing) => `## ${listing.title}\n\n${listing.description}\n\n${listing.bullets.map((bullet) => `- ${bullet}`).join("\n")}`).join("\n\n"));
  return { listings, files_created: [json.path, md.path] };
}

async function generateOpenAIImage(input, context, kind) {
  const apiKey = context.config.dalleApiKey || context.config.openaiApiKey;
  if (!apiKey) {
    return {
      error: true,
      configured: false,
      requiredEnv: "DALLE_API_KEY or OPENAI_API_KEY",
      message: "Image generation is not configured. Add DALLE_API_KEY or OPENAI_API_KEY server-side."
    };
  }
  const prompt = kind === "logo"
    ? `Logo concept reference for ${input.business_name}, ${input.style || "premium modern"}, colors ${Array.isArray(input.colors) ? input.colors.join(", ") : "cyan and blue"}. No text except the brand name if needed.`
    : kind === "hero"
      ? `Premium website hero image for ${input.business_name}: ${input.tagline || ""}. Style: ${input.style || "modern studio photography"}.`
      : `Product image of ${input.product_name}. ${input.description || ""}. Style: ${input.style || "product_photo"}. Background: ${input.background || "clean studio"}.`;
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
  const approvalScope = { provider: "openai_images", kind, promptHash };
  const approved = approvalFor(context, input.approval_id, "agent101_paid_image");
  if (!approved || !scopeMatches(approved, approvalScope)) {
    const request = await requestApproval(context, {
      action: `Generate one ${kind} image with the configured OpenAI image provider`,
      reason: "Image generation is a paid external API call and must be approved for this exact prompt hash.",
      risk_level: "medium",
      minimumRisk: "high",
      actionType: "agent101_paid_image",
      details: approvalScope,
      linkedId: `agent101_image:${context.runId}:${promptHash}`
    });
    return { requiresApproval: true, ...request, provider: "openai_images", kind, prompt_hash: promptHash, generated: false };
  }
  let reservationId = "";
  try {
    reservationId = await context.beforeModelCall?.({
      provider: "openai",
      model: "dall-e-3",
      estimatedInputTokens: Math.max(256, Math.ceil(prompt.length / 4)),
      maxOutputTokens: 64,
      estimatedCostUsd: 0.20
    }) || "";
    await consumeApproval(context, approved, "agent101_paid_image", approvalScope);
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "dall-e-3", prompt, size: "1024x1024", n: 1, response_format: "b64_json" }),
      signal: AbortSignal.timeout(120_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "OpenAI image generation failed.");
    const item = data.data?.[0] || {};
    if (!item.b64_json) throw new Error("Image provider did not return the requested inline image bytes.");
    const buffer = Buffer.from(item.b64_json, "base64");
    if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error("Image provider returned an invalid image payload size.");
    const baseName = kind === "logo" ? "logo-concept" : kind === "hero" ? "hero" : slugify(input.product_name || "product");
    const file = await writeOutputFile(context, `images/${baseName}-${promptHash.slice(0, 10)}.png`, buffer);
    await context.recordUsage?.("openai", {}, { estimatedCostUsd: 0.20 }, reservationId);
    return {
      image_path: file.path,
      prompt_used: prompt,
      note: kind === "product" ? "AI-generated placeholder. Real product photos will outperform it." : "AI-generated concept reference.",
      approval_id: approved.id
    };
  } catch (error) {
    await context.providerCallFailed?.(reservationId, error);
    throw error;
  }
}

async function searchWeb(input, context) {
  const query = cleanText(input.query);
  if (!query) throw new Error("query is required.");
  const provider = context.config.braveApiKey ? "brave" : context.config.serpApiKey ? "serpapi" : "";
  if (!provider) {
    return {
      error: true,
      configured: false,
      requiredEnv: "BRAVE_API_KEY or SERP_API_KEY",
      message: "No web search provider is configured. Add BRAVE_API_KEY or SERP_API_KEY server-side."
    };
  }
  const purpose = cleanText(input.purpose);
  const queryHash = crypto.createHash("sha256").update(query).digest("hex");
  const approvalScope = { provider, queryHash, purpose };
  const approved = approvalFor(context, input.approval_id, "agent101_web_search");
  if (!approved || !scopeMatches(approved, approvalScope)) {
    const request = await requestApproval(context, {
      action: `Search the public web with ${provider}`,
      reason: "Web search sends the exact query to an external provider and may consume a paid API quota.",
      risk_level: "medium",
      minimumRisk: "medium",
      actionType: "agent101_web_search",
      details: approvalScope,
      linkedId: `agent101_web_search:${context.runId}:${provider}:${queryHash}`
    });
    return { requiresApproval: true, ...request, provider, query_hash: queryHash, searched: false };
  }
  await consumeApproval(context, approved, "agent101_web_search", approvalScope);
  await context.logEvent?.("agent101_web_search", "Agent 101 started an approved web search", { queryHash, provider, purpose });
  if (provider === "brave") {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { "x-subscription-token": context.config.braveApiKey, accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.detail || "Brave Search failed.");
    return {
      provider: "brave",
      results: (data.web?.results || []).map((item) => ({ title: item.title, url: item.url, snippet: item.description })).slice(0, 8)
    };
  }
  if (provider === "serpapi") {
    const response = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(context.config.serpApiKey)}`, {
      signal: AbortSignal.timeout(20_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "SerpAPI search failed.");
    return {
      provider: "serpapi",
      results: (data.organic_results || []).map((item) => ({ title: item.title, url: item.link, snippet: item.snippet })).slice(0, 8)
    };
  }
  throw new Error("The selected web search provider is unavailable.");
}

async function analyzeCompetitor(input, context) {
  const url = cleanText(input.url);
  if (!url) throw new Error("url is required.");
  if (!context.browserWorkspace) {
    return { error: true, message: "Browser workspace is not available for competitor analysis." };
  }
  const approvalScope = { url };
  const approved = approvalFor(context, input.approval_id, "agent101_browser_navigation");
  if (!approved || !scopeMatches(approved, approvalScope)) {
    const request = await requestApproval(context, {
      action: `Open competitor page for analysis: ${url}`,
      reason: "Starting a browser session and navigating externally requires Human Gate approval for the exact URL.",
      risk_level: "medium",
      minimumRisk: "medium",
      actionType: "agent101_browser_navigation",
      details: approvalScope,
      linkedId: `agent101_browser:${context.runId}:${crypto.createHash("sha256").update(url).digest("hex")}`
    });
    return { requiresApproval: true, ...request, url, navigated: false };
  }
  await consumeApproval(context, approved, "agent101_browser_navigation", approvalScope);
  const workspace = context.browserWorkspace();
  const session = await workspace.createSession({ purpose: `Competitor analysis: ${url}`, actor: "agent101", forceNew: true });
  const nav = await workspace.navigate(session.id, url, { actor: "agent101" });
  if (!nav.allowed) return { error: true, message: nav.reason || "Navigation was blocked by browser policy." };
  const visible = await workspace.visibleText(session.id);
  const shot = await workspace.screenshot(session.id);
  const shotFile = await writeOutputFile(context, `research/${slugify(url, "competitor")}/screenshot.png`, shot);
  const focus = Array.isArray(input.focus) ? input.focus : ["pricing", "copy", "design_patterns"];
  const localAnalysis = `Competitive analysis for ${url}\n\nFocus: ${focus.join(", ")}\n\nObserved page text excerpt:\n${visible.text.slice(0, 2000)}\n\nRecommendations:\n- Compare offer clarity above the fold.\n- Build a stronger proof section than the competitor.\n- Add clearer pricing or intake path if the competitor buries it.`;
  return {
    url,
    focus,
    screenshot: shotFile.path,
    text_excerpt: visible.text.slice(0, 4000),
    analysis: localAnalysis,
    approval_id: approved.id
  };
}

async function createProjectPlan(input, context) {
  const slug = slugify(input.goal || "project-plan");
  const plan = {
    goal: input.goal,
    timeline: input.timeline || "2 weeks",
    phases: [
      { name: "Definition", tasks: ["Confirm offer", "Confirm inputs", "Set acceptance criteria"] },
      { name: "Build", tasks: ["Scaffold files", "Wire integrations with env placeholders", "Create operator docs"] },
      { name: "Verify", tasks: ["Run local smoke test", "Scan generated files for secrets", "Prepare handoff"] },
      { name: "Launch prep", tasks: ["Operator creates accounts", "Operator adds keys", "Operator deploys"] }
    ],
    dependencies: input.resources || {}
  };
  const md = `# Project Plan

Goal: ${input.goal}
Timeline: ${plan.timeline}

${plan.phases.map((phase) => `## ${phase.name}\n${phase.tasks.map((task) => `- ${task}`).join("\n")}`).join("\n\n")}
`;
  const file = await writeOutputFile(context, `plans/${slug}/project-plan.md`, md);
  return { plan, files_created: [file.path] };
}

async function createBusinessBlueprint(input, context) {
  const name = cleanText(input.business_name || input.name) || inferBusinessName(input.description, "New Business");
  const description = cleanText(input.description || input.goal) || `${name} business launch`;
  const audience = cleanText(input.target_audience) || "A clearly defined early-adopter customer segment that values quality, speed, and transparent delivery.";
  const offers = Array.isArray(input.offers) && input.offers.length
    ? input.offers.map((offer) => typeof offer === "string" ? offer : offer?.name).filter(Boolean)
    : ["Starter offer for first-time buyers", "Premium offer for higher-value custom work", "Repeat-order or retained service offer"];
  const blueprint = {
    business: { name, description, stage: input.stage || "validation_and_launch" },
    assumptions: [
      "Prices, unit economics, legal requirements, and production capacity are hypotheses until the operator verifies them.",
      "External accounts, domains, provider activation, customer contact, spending, and publishing remain operator-controlled.",
    ],
    customer: {
      targetAudience: audience,
      problem: cleanText(input.customer_problem) || "Customers need a reliable way to turn a specific request into a finished product without unclear pricing or production back-and-forth.",
      buyingTriggers: ["A concrete project deadline", "Proof of finish quality", "Clear specifications and price", "Fast, accountable communication"],
    },
    offerAndPositioning: {
      promise: cleanText(input.positioning) || `${name} delivers custom work through a clear intake, transparent production steps, and operator-reviewed quality.`,
      offers,
      differentiation: ["Proof-led product presentation", "Structured intake before payment", "Visible production and fulfillment status", "Quality review before delivery"],
    },
    revenueModel: {
      model: "Direct product/service sales with premium custom-work upsells and repeat-order retention.",
      pricingMethod: "Material or labor cost + production time + failure allowance + packaging/fees + target contribution margin.",
      unknowns: ["Verified demand", "Supplier and material cost", "Production throughput", "Refund/rework rate", "Customer acquisition cost"],
    },
    operations: {
      workflow: ["Qualified intake", "Specification review", "Quote or catalog selection", "Payment authorization", "Production", "Quality control", "Fulfillment", "Post-purchase follow-up"],
      records: ["Customer specification", "Order and payment IDs", "Production status", "Quality notes", "Fulfillment tracking", "Consent and communication history"],
      controls: ["No production from incomplete specifications", "No live provider activation without test-mode verification", "No customer email without Human Gate and explicit enablement"],
    },
    productAndWebsite: {
      requiredFlows: ["Offer discovery", "Product/specification detail", "Cart or quote intake", "Server-side checkout", "Signed webhook to order record", "Order dashboard", "Confirmation and status communication"],
      proofAssets: ["Real product imagery", "Material/specification guide", "Lead-time statement", "Quality examples", "Policies and contact identity"],
    },
    marketingAndSales: {
      launchChannels: ["High-intent search landing pages", "Short proof-of-process content", "Local and niche partnerships", "Referral follow-up"],
      funnel: ["Qualified visit", "Offer/specification engagement", "Checkout or quote start", "Paid/qualified order", "Fulfilled order", "Repeat/referral"],
      firstExperiments: ["Interview ten target buyers", "Test three offer/pricing frames", "Publish proof only after operator review", "Track conversion by source"],
    },
    risksAndOpenDecisions: [
      "Verify business registration, tax, privacy, refund, product-safety, and shipping obligations for the operating jurisdiction.",
      "Choose the first narrow customer and offer before buying inventory or advertising.",
      "Confirm real capacity, turnaround time, failure allowance, and margin before accepting orders.",
      "Select provider accounts and deployment target; credentials stay server-side.",
    ],
    kpis: ["Qualified leads", "Checkout/quote conversion", "Average order value", "Contribution margin", "On-time fulfillment", "Rework/refund rate", "Repeat order rate"],
    launchChecklist: [
      "Confirm customer, problem, and first offer",
      "Validate price and unit economics with real costs",
      "Replace placeholder product data and media",
      "Run checkout and webhook in provider test mode",
      "Protect admin and customer data",
      "Verify policies and jurisdiction-specific obligations",
      "Complete end-to-end order and fulfillment rehearsal",
      "Request Human Gate approval for deployment or publishing",
    ],
    createdAt: now(),
  };
  const slug = slugify(name);
  const json = await writeOutputFile(context, `businesses/${slug}/business-blueprint.json`, `${JSON.stringify(blueprint, null, 2)}\n`);
  const markdown = `# ${name} Business Blueprint

> Assumptions are labeled and must be verified before spending, publishing, or accepting real orders.

## Problem and target customer
${blueprint.customer.problem}

Target: ${blueprint.customer.targetAudience}

## Offer and positioning
${blueprint.offerAndPositioning.promise}

${offers.map((offer) => `- ${offer}`).join("\n")}

## Revenue model and assumptions
${blueprint.revenueModel.model}

Pricing method: ${blueprint.revenueModel.pricingMethod}

Unknowns: ${blueprint.revenueModel.unknowns.join(", ")}

## Operating workflow
${blueprint.operations.workflow.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Website and order system
${blueprint.productAndWebsite.requiredFlows.map((flow) => `- ${flow}`).join("\n")}

## Marketing and sales
${blueprint.marketingAndSales.firstExperiments.map((experiment) => `- ${experiment}`).join("\n")}

## Risks and open decisions
${blueprint.risksAndOpenDecisions.map((risk) => `- ${risk}`).join("\n")}

## KPIs
${blueprint.kpis.map((kpi) => `- ${kpi}`).join("\n")}

## Launch checklist
${blueprint.launchChecklist.map((item) => `- [ ] ${item}`).join("\n")}
`;
  const md = await writeOutputFile(context, `businesses/${slug}/BUSINESS_BLUEPRINT.md`, markdown);
  return { blueprint, files_created: [json.path, md.path], assumptions: blueprint.assumptions, unknowns: blueprint.risksAndOpenDecisions };
}

async function createHandoffDoc(input, context) {
  const projectPath = normalizeRelativePath(input.project_path || `projects/${context.sessionId || "agent101"}`, { stripOutputs: true });
  const built = Array.isArray(input.what_was_built) ? input.what_was_built : [];
  const todo = Array.isArray(input.what_operator_must_do) ? input.what_operator_must_do : [];
  const content = `# Agent 101 Handoff

Generated: ${now()}

## What Was Built
${built.length ? built.map((item) => `- ${item}`).join("\n") : "- Output files were generated in the project outputs directory."}

## What The Operator Must Do
${todo.length ? todo.map((item) => `- ${item}`).join("\n") : "- Review generated files, add real provider keys in environment variables, and test locally before deployment."}

## How To Test
1. Open the generated project folder.
2. Run \`npm install\` if a package.json exists.
3. Copy \`.env.example\` to \`.env\` and fill server-side keys only.
4. Run \`npm start\`.
5. Test the customer path from landing page to confirmation.

## Safety Notes
- No live API keys were written to generated files.
- External publishing and account setup remain operator-controlled.
- Shell commands require Human Gate approval inside Argentum OS.
`;
  const file = await writeOutputFile(context, `${projectPath}/HANDOFF.md`, content);
  return { handoff: content, path: file.path, files_created: [file.path] };
}

async function verifyOutputProject(input, context) {
  const project = resolveExistingOutputPath(context, input.project_path || input.website_path || "websites/site");
  await assertNoSymlinkTraversal(context.outputRoot, project.absolute);
  const required = [...new Set([
    "package.json",
    "server.js",
    "public/index.html",
    "README.md",
    ...(Array.isArray(input.required_files) ? input.required_files : [])
  ])];
  const checks = [];
  for (const relative of required) {
    const absolute = ensureInside(project.absolute, path.resolve(project.absolute, normalizeRelativePath(relative)));
    const exists = await fs.stat(absolute).then((stats) => stats.isFile()).catch(() => false);
    checks.push({ check: `file:${relative}`, status: exists ? "pass" : "fail", evidence: exists ? relative : "missing" });
  }

  const serverPath = path.join(project.absolute, "server.js");
  const hasServer = await fs.stat(serverPath).then((stats) => stats.isFile()).catch(() => false);
  if (hasServer) {
    const syntax = await execFileAsync(process.execPath, ["--check", serverPath], {
      cwd: project.absolute,
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      env: safeChildEnvironment()
    }).then(
      () => ({ status: "pass", evidence: "node --check" }),
      (error) => ({ status: "fail", evidence: redactSensitiveOutput(error.stderr || error.message) })
    );
    checks.push({ check: "server-syntax", ...syntax });
  } else checks.push({ check: "server-syntax", status: "fail", evidence: "server.js is missing; runtime verification cannot run." });

  const secretPatterns = [
    /\bsk_live_[A-Za-z0-9_-]{8,}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
    /\b(?:API_KEY|AUTH_TOKEN|CLIENT_SECRET|PASSWORD)\s*=\s*[^\s#][^\n]*/i
  ];
  const outputFiles = await listOutputFiles(project.absolute);
  const executableFiles = outputFiles.filter((item) => /(?:^|\/)(?:[^/]+\.)?(?:cjs|js|mjs)$/.test(item.path));
  const executableHashes = [];
  for (const file of executableFiles) {
    const relative = file.path.replace(/^outputs\//, "");
    const absolute = ensureInside(project.absolute, path.join(project.absolute, relative));
    await assertNoSymlinkTraversal(project.absolute, absolute);
    const content = await fs.readFile(absolute);
    executableHashes.push({
      path: `outputs/${project.relative}/${relative}`,
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    });
  }
  executableHashes.sort((a, b) => a.path.localeCompare(b.path));
  const executableFingerprint = crypto.createHash("sha256").update(JSON.stringify(executableHashes)).digest("hex");
  const deterministicTrusted = executableHashes.length > 0 && executableHashes.every((file) => context.trustedOutputHashes?.get(file.path) === file.sha256);
  const javascriptFailures = [];
  for (const file of outputFiles.filter((item) => /\.(?:cjs|js|mjs)$/.test(item.path))) {
    const absolute = path.join(project.absolute, file.path.replace(/^outputs\//, ""));
    await execFileAsync(process.execPath, ["--check", absolute], {
      cwd: project.absolute,
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      env: safeChildEnvironment()
    }).catch((error) => javascriptFailures.push({ path: file.path, error: redactSensitiveOutput(error.stderr || error.message).slice(0, 1000) }));
  }
  checks.push({
    check: "all-javascript-syntax",
    status: javascriptFailures.length ? "fail" : "pass",
    evidence: javascriptFailures.length ? javascriptFailures : `${outputFiles.filter((item) => /\.(?:cjs|js|mjs)$/.test(item.path)).length} JavaScript file(s) passed node --check.`
  });
  const jsonFailures = [];
  for (const file of outputFiles.filter((item) => /\.json$/i.test(item.path))) {
    const absolute = path.join(project.absolute, file.path.replace(/^outputs\//, ""));
    try {
      JSON.parse(await fs.readFile(absolute, "utf8"));
    } catch (error) {
      jsonFailures.push({ path: file.path, error: redactSensitiveOutput(error.message).slice(0, 1000) });
    }
  }
  checks.push({
    check: "all-json-parse",
    status: jsonFailures.length ? "fail" : "pass",
    evidence: jsonFailures.length ? jsonFailures : `${outputFiles.filter((item) => /\.json$/i.test(item.path)).length} JSON file(s) parsed successfully.`
  });
  const shellFailures = [];
  for (const file of outputFiles.filter((item) => /\.sh$/i.test(item.path))) {
    const absolute = path.join(project.absolute, file.path.replace(/^outputs\//, ""));
    await execFileAsync("/bin/bash", ["-n", absolute], {
      cwd: project.absolute,
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      env: safeChildEnvironment()
    }).catch((error) => shellFailures.push({ path: file.path, error: redactSensitiveOutput(error.stderr || error.message).slice(0, 1000) }));
  }
  checks.push({
    check: "all-shell-syntax",
    status: shellFailures.length ? "fail" : "pass",
    evidence: shellFailures.length ? shellFailures : `${outputFiles.filter((item) => /\.sh$/i.test(item.path)).length} shell file(s) passed bash -n.`
  });
  const leaked = [];
  for (const file of outputFiles) {
    const absolute = path.join(project.absolute, file.path.replace(/^outputs\//, ""));
    if (!fileExtensionAllowedForText(absolute) || file.bytes > MAX_TEXT_BYTES) continue;
    const content = await fs.readFile(absolute, "utf8");
    if (secretPatterns.some((pattern) => pattern.test(content))) leaked.push(file.path);
  }
  checks.push({ check: "secret-scan", status: leaked.length ? "fail" : "pass", evidence: leaked.length ? leaked : "No raw secret patterns found." });

  let executionApproval = null;
  let executionAuthorized = deterministicTrusted;
  if (!executionAuthorized && checks.every((check) => check.status === "pass") && hasServer) {
    const approvalScope = {
      action: "verify_output_boot",
      projectPath: `outputs/${project.relative}`,
      executableFingerprint
    };
    const approved = approvalFor(context, input.approval_id, "agent101_output_execution");
    if (approved && scopeMatches(approved, approvalScope)) {
      await consumeApproval(context, approved, "agent101_output_execution", approvalScope);
      executionAuthorized = true;
    } else {
      executionApproval = await requestApproval(context, {
        action: `Run hash-locked generated project for verification: outputs/${project.relative}`,
        reason: "This project contains executable files not produced entirely by Argentum's deterministic builders. Host execution requires Human Gate approval for the exact executable fingerprint.",
        risk_level: "critical",
        minimumRisk: "critical",
        actionType: "agent101_output_execution",
        details: approvalScope,
        linkedId: `agent101_output_execution:${context.runId}:${executableFingerprint}`
      });
    }
  }
  checks.push({
    check: "runtime-execution-authorization",
    status: executionAuthorized ? "pass" : "fail",
    evidence: deterministicTrusted
      ? "All executable hashes came from deterministic Argentum builder tools in this run."
      : executionAuthorized
        ? `Human Gate approved executable fingerprint ${executableFingerprint}.`
        : `Host execution blocked pending Human Gate approval for fingerprint ${executableFingerprint}.`
  });

  const shouldBoot = executionAuthorized && checks.every((check) => check.status === "pass") && hasServer;
  let runtime = null;
  if (shouldBoot) {
    const port = 42000 + crypto.randomInt(0, 2000);
    const stdout = [];
    const stderr = [];
    const child = spawn(process.execPath, [serverPath], {
      cwd: project.absolute,
      env: { ...safeChildEnvironment(), PORT: String(port), PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, ADMIN_TOKEN: "agent101-local-verification-token" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => stdout.push(String(chunk).slice(0, 4000)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk).slice(0, 4000)));
    try {
      let response = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        response = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
        if (response?.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!response?.ok) throw new Error(`Generated server did not become healthy. ${stderr.join("").slice(0, 1000)}`);
      const productsResponse = await fetch(`http://127.0.0.1:${port}/api/products`);
      const hasOrderStore = await fs.stat(path.join(project.absolute, "server", "order-store.js")).then(() => true).catch(() => false);
      const unauthenticatedAdminResponse = hasOrderStore ? await fetch(`http://127.0.0.1:${port}/api/admin/orders`) : null;
      const adminResponse = hasOrderStore ? await fetch(`http://127.0.0.1:${port}/api/admin/orders`, {
        headers: { authorization: "Bearer agent101-local-verification-token" }
      }) : null;
      runtime = {
        homeStatus: response.status,
        productsStatus: productsResponse.status,
        adminOrdersStatus: adminResponse?.status || null,
        unauthenticatedAdminStatus: unauthenticatedAdminResponse?.status || null,
        stdout: redactSensitiveOutput(stdout.join("")).slice(0, 4000)
      };
      checks.push({ check: "runtime-home", status: response.ok ? "pass" : "fail", evidence: `HTTP ${response.status}` });
      checks.push({ check: "runtime-products", status: productsResponse.ok ? "pass" : "fail", evidence: `HTTP ${productsResponse.status}` });
      if (adminResponse) checks.push({ check: "runtime-admin-orders", status: adminResponse.ok ? "pass" : "fail", evidence: `HTTP ${adminResponse.status}` });
      if (unauthenticatedAdminResponse) checks.push({ check: "runtime-admin-auth", status: unauthenticatedAdminResponse.status === 401 ? "pass" : "fail", evidence: `Unauthenticated HTTP ${unauthenticatedAdminResponse.status}` });
    } catch (error) {
      checks.push({ check: "runtime-boot", status: "fail", evidence: redactSensitiveOutput(error.message) });
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (!child.killed) child.kill("SIGKILL");
    }
  }

  const verified = checks.every((check) => check.status === "pass");
  const report = {
    verified,
    project_path: `outputs/${project.relative}`,
    executableFingerprint,
    executableFiles: executableHashes,
    executionTrust: deterministicTrusted ? "deterministic_builder" : executionAuthorized ? "human_gate_hash_approval" : "blocked",
    checks,
    runtime,
    verifiedAt: now()
  };
  const reportFile = await writeOutputFile(context, `${project.relative}/VERIFICATION.json`, `${JSON.stringify(report, null, 2)}\n`);
  return {
    ...report,
    ...(executionApproval ? { requiresApproval: true, ...executionApproval } : {}),
    files_created: [reportFile.path]
  };
}

export const TOOL_REGISTRY = [
  { name: "read_file", description: "Read a bounded slice of a text file from the approved project. Use offset_bytes to continue large files; secrets and path traversal are blocked.", input_schema: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, offset_bytes: { type: "integer", minimum: 0 }, max_chars: { type: "integer", minimum: 1, maximum: 120000 } }, required: ["path"] } },
  { name: "search_project_text", description: "Search readable project source for exact text and return file paths, line numbers, and bounded excerpts without using shell.", input_schema: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, path: { type: "string" }, case_sensitive: { type: "boolean" }, max_results: { type: "integer", minimum: 1, maximum: 100 } }, required: ["query"] } },
  { name: "write_file", description: "Create a new file inside Agent 101 outputs, or replace one only after exact Human Gate approval locks the old and new hashes.", input_schema: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, content: { type: "string" }, approval_id: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_files", description: "List files and directories inside the project directory.", input_schema: { type: "object", additionalProperties: false, properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "delete_file", description: "Delete one file from Agent 101 outputs after Human Gate approves that exact path.", input_schema: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, approval_id: { type: "string" } }, required: ["path"] } },
  { name: "run_shell", description: "Run an approved project-local shell command through execFile. Requires Human Gate approval first.", input_schema: { type: "object", additionalProperties: false, properties: { command: { type: "string" }, cwd: { type: "string" }, approval_id: { type: "string" } }, required: ["command"] } },
  { name: "scaffold_website", description: "Generate a complete multi-page premium vanilla website scaffold in outputs/websites.", input_schema: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, type: { type: "string", enum: ["shop", "landing", "saas", "portfolio", "blog"] }, description: { type: "string" }, pages: { type: "array", items: { type: "string" } }, features: { type: "array", items: { type: "string" } } }, required: ["name", "type", "description"] } },
  { name: "add_stripe_checkout", description: "Add server-side Stripe Checkout integration files and setup docs to an output website.", input_schema: { type: "object", additionalProperties: false, properties: { website_path: { type: "string" }, products: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, price_cents: { type: "number" }, currency: { type: "string" } }, required: ["name", "description", "price_cents", "currency"] } } }, required: ["website_path", "products"] } },
  { name: "add_email_flow", description: "Generate approval-gated email templates, Resend or SendGrid sending logic, webhook wiring, and setup docs.", input_schema: { type: "object", additionalProperties: false, properties: { website_path: { type: "string" }, events: { type: "array", items: { type: "string", enum: ["order_confirmation", "shipping_update", "abandoned_cart", "welcome", "password_reset"] } }, provider: { type: "string", enum: ["resend", "sendgrid"] } }, required: ["website_path", "events", "provider"] } },
  { name: "generate_deployment_config", description: "Generate deployment configuration for Railway, Render, Vercel, Fly.io, or VPS Nginx.", input_schema: { type: "object", additionalProperties: false, properties: { website_path: { type: "string" }, platform: { type: "string", enum: ["railway", "render", "vercel", "fly_io", "vps_nginx"] } }, required: ["website_path", "platform"] } },
  { name: "write_copy", description: "Generate premium copy locally, or with Claude only after Human Gate approves the exact paid provider input.", input_schema: { type: "object", additionalProperties: false, properties: { type: { type: "string" }, business: { type: "object" }, tone: { type: "string" }, length: { type: "string" }, approval_id: { type: "string" } }, required: ["type", "business", "tone", "length"] } },
  { name: "generate_brand_identity", description: "Create a structured brand identity document and write it to outputs/brand.", input_schema: { type: "object", additionalProperties: false, properties: { business_description: { type: "string" }, industry: { type: "string" }, target_audience: { type: "string" }, vibe: { type: "string" } }, required: ["business_description", "industry", "target_audience", "vibe"] } },
  { name: "write_product_listings", description: "Write structured product listings for a marketplace or website.", input_schema: { type: "object", additionalProperties: false, properties: { products: { type: "array", items: { type: "object", properties: { name: { type: "string" }, material: { type: "string" }, use_case: { type: "string" }, dimensions: { type: "string" } }, required: ["name"] } }, platform: { type: "string", enum: ["shopify", "etsy", "website", "amazon"] }, tone: { type: "string" } }, required: ["products", "platform", "tone"] } },
  { name: "generate_product_image", description: "Generate a product image with DALL-E/OpenAI after Human Gate approves the paid API call.", input_schema: { type: "object", additionalProperties: false, properties: { product_name: { type: "string" }, description: { type: "string" }, style: { type: "string" }, background: { type: "string" }, approval_id: { type: "string" } }, required: ["product_name", "description", "style", "background"] } },
  { name: "generate_hero_image", description: "Generate a website hero image with DALL-E/OpenAI after Human Gate approves the paid API call.", input_schema: { type: "object", additionalProperties: false, properties: { business_name: { type: "string" }, tagline: { type: "string" }, style: { type: "string" }, approval_id: { type: "string" } }, required: ["business_name", "tagline", "style"] } },
  { name: "generate_logo_concept", description: "Generate a logo concept with DALL-E/OpenAI after Human Gate approves the paid API call.", input_schema: { type: "object", additionalProperties: false, properties: { business_name: { type: "string" }, style: { type: "string" }, colors: { type: "array", items: { type: "string" } }, approval_id: { type: "string" } }, required: ["business_name", "style", "colors"] } },
  { name: "search_web", description: "Search the public web with Brave Search or SerpAPI only after Human Gate approves the exact query hash and purpose.", input_schema: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, purpose: { type: "string" }, approval_id: { type: "string" } }, required: ["query", "purpose"] } },
  { name: "analyze_competitor", description: "Use the supervised browser workspace after Human Gate approves navigation to the exact public URL.", input_schema: { type: "object", additionalProperties: false, properties: { url: { type: "string" }, focus: { type: "array", items: { type: "string", enum: ["pricing", "copy", "product_range", "design_patterns", "seo"] } }, approval_id: { type: "string" } }, required: ["url", "focus"] } },
  { name: "get_market_data", description: "Return training-data market context with confidence and verification notes.", input_schema: { type: "object", additionalProperties: false, properties: { industry: { type: "string" }, question: { type: "string" } }, required: ["industry", "question"] } },
  { name: "create_project_plan", description: "Create a structured project plan and write it to outputs/plans.", input_schema: { type: "object", additionalProperties: false, properties: { goal: { type: "string" }, timeline: { type: "string" }, resources: { type: "object" } }, required: ["goal", "timeline", "resources"] } },
  { name: "create_business_blueprint", description: "Create an operator-grade business blueprint covering customer, offer, revenue assumptions, operations, product/site flows, marketing, risks, KPIs, and launch decisions.", input_schema: { type: "object", additionalProperties: false, properties: { business_name: { type: "string" }, description: { type: "string" }, target_audience: { type: "string" }, customer_problem: { type: "string" }, positioning: { type: "string" }, stage: { type: "string" }, offers: { type: "array", items: { anyOf: [{ type: "string" }, { type: "object", properties: { name: { type: "string" } }, required: ["name"] }] } } }, required: ["business_name", "description"] } },
  { name: "create_handoff_doc", description: "Create a clean operator handoff document for generated outputs.", input_schema: { type: "object", additionalProperties: false, properties: { project_path: { type: "string" }, what_was_built: { type: "array", items: { type: "string" } }, what_operator_must_do: { type: "array", items: { type: "string" } } }, required: ["project_path", "what_was_built", "what_operator_must_do"] } },
  { name: "capcut_edit_clip", description: "Stage a verified rendered clip inside the native Mac CapCut desktop app. Export/download remains Human Gate and operator controlled.", input_schema: { type: "object", additionalProperties: false, properties: { clip_id: { type: "string" }, clipPath: { type: "string" }, rendered_artifact_id: { type: "string" }, sourceProvenance: { type: "string" }, edit_spec: { type: "object" }, practice_confirmed: { type: "boolean" }, brandSticker: { type: "string" }, stickerScale: { type: "number" }, export_approval_id: { type: "string" } }, required: ["edit_spec"] } },
  { name: "request_human_approval", description: "Create a Human Gate approval request for risky or irreversible actions.", input_schema: { type: "object", additionalProperties: false, properties: { action: { type: "string" }, reason: { type: "string" }, risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] }, details: { type: "object" } }, required: ["action", "reason", "risk_level", "details"] } },
  { name: "check_approval_status", description: "Check whether a Human Gate approval request is pending, approved, or rejected.", input_schema: { type: "object", additionalProperties: false, properties: { approval_id: { type: "string" } }, required: ["approval_id"] } }
  ,{ name: "inspect_project_workspace", description: "Inspect the approved Argentum project workspace, source-edit policy, and current edit proposals.", input_schema: { type: "object", additionalProperties: false, properties: {} } }
  ,{ name: "propose_project_edit", description: "Create a hash-locked source proposal using complete content or narrow exact replacements. It never writes source and always creates a Human Gate request. Validation is selected by the trusted runtime, never by the agent.", input_schema: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, content: { type: "string" }, replacements: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", additionalProperties: false, properties: { search: { type: "string" }, replace: { type: "string" }, expected_count: { type: "integer", minimum: 1, maximum: 100 } }, required: ["search", "replace"] } }, reason: { type: "string" }, expected_sha256: { type: "string" } }, required: ["path", "reason"] } }
  ,{ name: "apply_project_edit", description: "Apply one previously proposed source edit only after Human Gate approves the exact proposal.", input_schema: { type: "object", additionalProperties: false, properties: { proposal_id: { type: "string" }, approval_id: { type: "string" } }, required: ["proposal_id", "approval_id"] } }
  ,{ name: "configure_studio_layout", description: "Reversibly reorder Agent 101 Studio panels and set density/accent without editing source code.", input_schema: { type: "object", additionalProperties: false, properties: { panels: { type: "array", items: { type: "string", enum: ["mission", "knowledge", "tools", "files", "approvals", "business_blueprint", "conversation"] } }, density: { type: "string", enum: ["comfortable", "compact"] }, accent: { type: "string", enum: ["blue", "violet", "gold", "emerald"] } }, required: ["panels"] } }
  ,{ name: "verify_output_project", description: "Run fixed file, syntax, secret, and HTTP acceptance checks. Host execution is automatic only for deterministic builder hashes; all other executable fingerprints require exact Human Gate approval.", input_schema: { type: "object", additionalProperties: false, properties: { project_path: { type: "string" }, required_files: { type: "array", items: { type: "string" } }, approval_id: { type: "string" } }, required: ["project_path"] } }
];

export async function executeTool(name, input = {}, context = {}) {
  switch (name) {
    case "read_file": {
      const filePath = resolveProjectPath(context, input.path);
      assertReadableProjectPath(context, filePath);
      await assertNoSymlinkTraversal(context.projectRoot, filePath);
      if (!fileExtensionAllowedForText(filePath)) throw new Error("Only text-like files can be read by Agent 101.");
      return { path: input.path, ...(await readFileLimited(filePath, input.max_chars || MAX_TEXT_BYTES, input.offset_bytes || 0)) };
    }
    case "search_project_text":
      return searchProjectText(input, context);
    case "write_file": {
      const content = String(input.content ?? "");
      if (!content.length) throw new Error("Agent 101 will not create or overwrite an output with empty content.");
      const target = resolveOutputPath(context, input.path);
      await assertNoSymlinkTraversal(context.outputRoot, target.absolute, { allowMissing: true });
      const existing = await fs.readFile(target.absolute).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
      if (existing !== null) {
        const approvalScope = {
          path: target.publicPath,
          expectedSha256: crypto.createHash("sha256").update(existing).digest("hex"),
          contentSha256: crypto.createHash("sha256").update(content).digest("hex")
        };
        const approved = approvalFor(context, input.approval_id, "agent101_output_overwrite");
        if (!approved || !scopeMatches(approved, approvalScope)) {
          const request = await requestApproval(context, {
            action: `Replace existing Agent 101 output: ${target.publicPath}`,
            reason: "Overwriting a saved output is destructive and requires approval for the exact before and after hashes.",
            risk_level: "high",
            minimumRisk: "high",
            actionType: "agent101_output_overwrite",
            details: approvalScope,
            linkedId: `agent101_output_overwrite:${context.runId}:${crypto.createHash("sha256").update(JSON.stringify(approvalScope)).digest("hex")}`
          });
          return { requiresApproval: true, ...request, written: false, ...approvalScope };
        }
        await consumeApproval(context, approved, "agent101_output_overwrite", approvalScope);
      }
      const file = await writeOutputFile(context, input.path, content, { approvedOverwrite: existing !== null });
      return { written: true, path: file.path, bytes: file.bytes };
    }
    case "list_files": {
      const dir = resolveProjectPath(context, input.path || ".");
      assertReadableProjectPath(context, dir);
      await assertNoSymlinkTraversal(context.projectRoot, dir);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const allowed = entries.filter((entry) => projectPathPolicy(context, path.join(dir, entry.name)).allowed);
      return {
        path: input.path || ".",
        files: allowed.filter((entry) => entry.isFile()).map((entry) => entry.name),
        directories: allowed.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      };
    }
    case "delete_file": {
      const file = resolveExistingOutputPath(context, input.path);
      await assertNoSymlinkTraversal(context.outputRoot, file.absolute);
      const publicPath = `outputs/${file.relative}`;
      const approvalScope = { path: publicPath };
      const approved = approvalFor(context, input.approval_id, "agent101_output_delete");
      if (!approved || !scopeMatches(approved, approvalScope)) {
        const request = await requestApproval(context, {
          action: `Delete Agent 101 output: ${publicPath}`,
          reason: "Deletion is irreversible and must be approved for this exact output file.",
          risk_level: "high",
          minimumRisk: "high",
          actionType: "agent101_output_delete",
          details: approvalScope,
          linkedId: `agent101_delete:${context.runId}:${crypto.createHash("sha1").update(publicPath).digest("hex")}`
        });
        return { requiresApproval: true, ...request, path: publicPath, deleted: false };
      }
      await consumeApproval(context, approved, "agent101_output_delete", approvalScope);
      const stats = await fs.stat(file.absolute);
      if (!stats.isFile()) throw new Error("Only files inside outputs can be deleted.");
      await fs.unlink(file.absolute);
      await context.logEvent?.("agent101_output_deleted", "Agent 101 deleted an approved output file", { path: publicPath, approvalId: approved.id });
      return { deleted: true, path: publicPath, approval_id: approved.id };
    }
    case "run_shell": {
      const parsed = validateShellCommand(input.command);
      const cwd = input.cwd ? resolveProjectPath(context, input.cwd) : context.projectRoot;
      assertReadableProjectPath(context, cwd);
      await assertNoSymlinkTraversal(context.projectRoot, cwd);
      const cwdRelative = projectRelativePath(context, cwd) || ".";
      if (parsed.commandName === "cat") {
        parsed.args.filter((item) => !item.startsWith("-")).forEach((item) => assertReadableProjectPath(context, resolveProjectPath({ ...context, projectRoot: cwd }, item)));
      }
      const approvalScope = { command: parsed.raw, cwd: cwdRelative };
      const approved = approvalFor(context, input.approval_id, "agent101_shell");
      if (!approved || !scopeMatches(approved, approvalScope)) {
        const request = await requestApproval(context, {
          action: `Run shell command: ${parsed.raw}`,
          reason: "Shell execution can modify the local project and must be approved in Human Gate first.",
          risk_level: "high",
          minimumRisk: "high",
          actionType: "agent101_shell",
          details: approvalScope,
          linkedId: `agent101_shell:${context.runId}:${crypto.createHash("sha1").update(parsed.raw).digest("hex")}`
        });
        return { requiresApproval: true, ...request, command: parsed.raw, cwd: cwdRelative, executed: false };
      }
      await consumeApproval(context, approved, "agent101_shell", approvalScope);
      const started = Date.now();
      const result = await execFileAsync(parsed.commandName, parsed.args, {
        cwd,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: safeChildEnvironment()
      }).then(
        ({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }),
        (error) => ({ stdout: error.stdout || "", stderr: error.stderr || error.message, exitCode: Number(error.code || 1) })
      );
      const safeResult = { ...result, stdout: redactSensitiveOutput(result.stdout), stderr: redactSensitiveOutput(result.stderr), durationMs: Date.now() - started, approval_id: approved.id };
      if (safeResult.exitCode !== 0) return { ...safeResult, error: true, message: safeResult.stderr || `Command exited with status ${safeResult.exitCode}.` };
      return safeResult;
    }
    case "scaffold_website":
      return scaffoldWebsite(input, context);
    case "add_stripe_checkout":
      return addStripeCheckout(input, context);
    case "add_email_flow":
      return addEmailFlow(input, context);
    case "generate_deployment_config":
      return generateDeploymentConfig(input, context);
    case "write_copy":
      return writeCopy(input, context);
    case "generate_brand_identity":
      return generateBrandIdentity(input, context);
    case "write_product_listings":
      return writeProductListings(input, context);
    case "generate_product_image":
      return generateOpenAIImage(input, context, "product");
    case "generate_hero_image":
      return generateOpenAIImage(input, context, "hero");
    case "generate_logo_concept":
      return generateOpenAIImage(input, context, "logo");
    case "search_web":
      return searchWeb(input, context);
    case "analyze_competitor":
      return analyzeCompetitor(input, context);
    case "get_market_data":
      return {
        label: "Training data - verify with current sources",
        industry: input.industry,
        question: input.question,
        context: "Use this as directional market context, not live market research.",
        likely_patterns: [
          "Clear niche positioning beats broad generic offers.",
          "Fast proof, transparent process, and simple checkout reduce buyer hesitation.",
          "Operator-owned customer data is more defensible than marketplace-only demand."
        ],
        confidence: "medium"
      };
    case "create_project_plan":
      return createProjectPlan(input, context);
    case "create_business_blueprint":
      return createBusinessBlueprint(input, context);
    case "create_handoff_doc":
      return createHandoffDoc(input, context);
    case "capcut_edit_clip": {
      if (typeof context.capcutEditClip !== "function") {
        throw new Error("CapCut Agent is unavailable in this runtime.");
      }
      return context.capcutEditClip(input);
    }
    case "request_human_approval":
      return requestApproval(context, { ...input, actionType: "agent101_advisory", minimumRisk: "medium" });
    case "check_approval_status": {
      const approval = (context.state?.approvalRequests || []).find((item) => item.id === input.approval_id) || null;
      if (!approval) return { approval_id: input.approval_id, status: "not_found" };
      return {
        approval_id: approval.id,
        status: approval.status,
        action: approval.title,
        decidedAt: approval.decidedAt || null,
        decisionNotes: approval.decisionNotes || "",
        consumedAt: approval.consumedAt || null
      };
    }
    case "inspect_project_workspace": {
      if (typeof context.projectWorkspace?.inspect !== "function") throw new Error("The supervised project workspace is unavailable in this runtime.");
      return context.projectWorkspace.inspect();
    }
    case "propose_project_edit": {
      if (typeof context.projectWorkspace?.propose !== "function") throw new Error("The supervised project workspace is unavailable in this runtime.");
      return context.projectWorkspace.propose(input);
    }
    case "apply_project_edit": {
      if (typeof context.projectWorkspace?.apply !== "function") throw new Error("The supervised project workspace is unavailable in this runtime.");
      return context.projectWorkspace.apply(input);
    }
    case "configure_studio_layout": {
      if (typeof context.configureStudioLayout !== "function") throw new Error("Studio layout configuration is unavailable in this runtime.");
      return context.configureStudioLayout(input);
    }
    case "verify_output_project":
      return verifyOutputProject(input, context);
    default:
      throw new Error(`Unknown Agent 101 tool: ${name}`);
  }
}

export async function listOutputFiles(outputRoot, prefix = "") {
  const root = path.resolve(outputRoot);
  const start = prefix ? ensureInside(root, path.resolve(root, normalizeRelativePath(prefix, { stripOutputs: true }))) : root;
  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const stats = await fs.stat(absolute);
        results.push({
          path: `outputs/${path.relative(root, absolute).replaceAll(path.sep, "/")}`,
          bytes: stats.size,
          updatedAt: stats.mtime.toISOString()
        });
      }
    }
  }
  await walk(start);
  return results;
}

export async function readOutputFile(outputRoot, rawPath) {
  const context = { outputRoot };
  const resolved = resolveExistingOutputPath(context, rawPath);
  const stats = await fs.stat(resolved.absolute);
  if (!stats.isFile()) throw new Error("Output file not found.");
  if (!fileExtensionAllowedForText(resolved.absolute)) {
    return { path: `outputs/${resolved.relative}`, binary: true, sizeBytes: stats.size, content: "" };
  }
  return { path: `outputs/${resolved.relative}`, binary: false, ...(await readFileLimited(resolved.absolute)) };
}

export async function resolveOutputDownload(outputRoot, rawPath) {
  const context = { outputRoot };
  const resolved = resolveExistingOutputPath(context, rawPath);
  await assertNoSymlinkTraversal(outputRoot, resolved.absolute);
  const stats = await fs.stat(resolved.absolute);
  if (!stats.isFile()) throw new Error("Output file not found.");
  return {
    path: `outputs/${resolved.relative}`,
    absolutePath: resolved.absolute,
    filename: path.basename(resolved.absolute),
    sizeBytes: stats.size,
  };
}

export function resultToToolText(result) {
  return truncate(result, MAX_TOOL_OUTPUT_CHARS);
}
