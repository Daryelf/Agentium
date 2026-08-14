const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SERVICE = "Argentum OS";

function now() {
  return new Date().toISOString();
}

function secretAccount(provider) {
  return `argentum.${String(provider || "").toLowerCase()}.api_key`;
}

function runSecurity(args, input = "") {
  return execFileSync("/usr/bin/security", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function canUseKeychain() {
  return process.env.ARGENTUM_DISABLE_KEYCHAIN !== "true" && process.platform === "darwin" && fs.existsSync("/usr/bin/security");
}

function setKeychainSecret(provider, value) {
  const account = secretAccount(provider);
  try {
    runSecurity(["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    // The item may not exist yet.
  }
  runSecurity(["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value]);
  return { storage: "mac_keychain", updatedAt: now() };
}

function getKeychainSecret(provider) {
  try {
    return runSecurity(["find-generic-password", "-s", SERVICE, "-a", secretAccount(provider), "-w"]).trim();
  } catch {
    return "";
  }
}

function deleteKeychainSecret(provider) {
  try {
    runSecurity(["delete-generic-password", "-s", SERVICE, "-a", secretAccount(provider)]);
  } catch {
    // Already absent.
  }
  return { storage: "mac_keychain", updatedAt: now() };
}

function fallbackFile(dataDir) {
  return path.join(dataDir || path.join(os.homedir(), ".argentum-os"), "argentum-local-secrets.json");
}

function machineKey() {
  return crypto.createHash("sha256").update(`${os.hostname()}|${os.homedir()}|argentum-os`).digest();
}

function readFallbackStore(dataDir) {
  const file = fallbackFile(dataDir);
  if (!fs.existsSync(file)) return { version: 1, secrets: {} };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { version: 1, secrets: {} };
  }
}

function writeFallbackStore(dataDir, store) {
  fs.mkdirSync(path.dirname(fallbackFile(dataDir)), { recursive: true });
  fs.writeFileSync(fallbackFile(dataDir), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", machineKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(payload) {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = String(payload || "").split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function setFallbackSecret(dataDir, provider, value) {
  const store = readFallbackStore(dataDir);
  store.secrets[provider] = { value: encryptSecret(value), updatedAt: now() };
  writeFallbackStore(dataDir, store);
  return { storage: "encrypted_local_file", updatedAt: store.secrets[provider].updatedAt };
}

function getFallbackSecret(dataDir, provider) {
  const store = readFallbackStore(dataDir);
  return decryptSecret(store.secrets?.[provider]?.value || "");
}

function deleteFallbackSecret(dataDir, provider) {
  const store = readFallbackStore(dataDir);
  if (store.secrets) delete store.secrets[provider];
  writeFallbackStore(dataDir, store);
  return { storage: "encrypted_local_file", updatedAt: now() };
}

function setSecret({ dataDir, provider, value, preferKeychain = true }) {
  if (preferKeychain && canUseKeychain()) return setKeychainSecret(provider, value);
  return setFallbackSecret(dataDir, provider, value);
}

function getSecret({ dataDir, provider, storage = "" }) {
  if (storage === "mac_keychain" || (!storage && canUseKeychain())) return getKeychainSecret(provider);
  return getFallbackSecret(dataDir, provider);
}

function deleteSecret({ dataDir, provider, storage = "" }) {
  if (storage === "mac_keychain" || (!storage && canUseKeychain())) return deleteKeychainSecret(provider);
  return deleteFallbackSecret(dataDir, provider);
}

function publicStorageLabel(storage) {
  if (storage === "mac_keychain") return "Mac Keychain";
  if (storage === "encrypted_local_file") return "Encrypted local file";
  return "Server-side";
}

module.exports = {
  canUseKeychain,
  deleteSecret,
  getSecret,
  publicStorageLabel,
  setSecret,
};
