const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_BACKUP_ROOT = path.join(os.homedir(), "Documents", "Argentum-Backups");

function now() {
  return new Date().toISOString();
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function walkFiles(targetPath, out = []) {
  if (!exists(targetPath)) return out;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    out.push(targetPath);
    return out;
  }
  fs.readdirSync(targetPath, { withFileTypes: true }).forEach((entry) => {
    const next = path.join(targetPath, entry.name);
    if (entry.isDirectory()) walkFiles(next, out);
    else if (entry.isFile()) out.push(next);
  });
  return out;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyIfExists(source, target) {
  if (!exists(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.statSync(source).isDirectory()) fs.cpSync(source, target, { recursive: true });
  else fs.copyFileSync(source, target);
  return true;
}

function manifestPath(backupPath) {
  return path.join(backupPath, "backup-manifest.json");
}

function latestBackup(backupRoot = DEFAULT_BACKUP_ROOT) {
  if (!exists(backupRoot)) return null;
  const dirs = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .filter((dir) => exists(manifestPath(dir)))
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function buildChecksums(backupPath) {
  const checksums = {};
  let fileCount = 0;
  let totalBytes = 0;
  walkFiles(backupPath).forEach((filePath) => {
    if (path.basename(filePath) === "backup-manifest.json") return;
    const rel = path.relative(backupPath, filePath).replaceAll(path.sep, "/");
    const stat = fs.statSync(filePath);
    checksums[rel] = sha256(filePath);
    fileCount += 1;
    totalBytes += stat.size;
  });
  return { checksums, fileCount, totalBytes };
}

function readSchemaVersion(backupPath) {
  const schemaPath = path.join(backupPath, "Argentum-Brain", "00_System", "Manifests", "vault-schema.json");
  if (!exists(schemaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(schemaPath, "utf8")).schemaVersion || null;
  } catch {
    return null;
  }
}

function createBrainBackup(options = {}) {
  const createdAt = now();
  const backupRoot = options.backupRoot || DEFAULT_BACKUP_ROOT;
  const backupPath = path.join(backupRoot, stamp(new Date(createdAt)));
  const vaultPath = path.resolve(options.vaultPath);
  const databasePath = options.databasePath ? path.resolve(options.databasePath) : "";
  const appConfigDir = options.appConfigDir ? path.resolve(options.appConfigDir) : "";
  fs.mkdirSync(backupPath, { recursive: true });

  copyIfExists(vaultPath, path.join(backupPath, "Argentum-Brain"));
  if (databasePath) copyIfExists(databasePath, path.join(backupPath, "argentum-local.sqlite"));
  if (appConfigDir) {
    [".env", ".env.local", "argentum-auth.json", "argentum-state.json", "argentum-session-secret.json"].forEach((name) => {
      copyIfExists(path.join(appConfigDir, name), path.join(backupPath, "app-config", name));
    });
  }
  copyIfExists(path.join(vaultPath, "00_System", "Manifests", "canonical-entities.json"), path.join(backupPath, "canonical-entities.json"));
  copyIfExists(path.join(vaultPath, "00_System", "Manifests", "search-index.json"), path.join(backupPath, "search-index.json"));

  const totals = buildChecksums(backupPath);
  const manifest = {
    backupId: `brain-backup-${path.basename(backupPath)}`,
    createdAt,
    backupPath,
    vaultPath,
    databasePath,
    appConfigPath: appConfigDir,
    schemaVersion: readSchemaVersion(backupPath),
    fileCount: totals.fileCount,
    totalBytes: totals.totalBytes,
    checksums: totals.checksums,
    verified: false,
  };
  fs.writeFileSync(manifestPath(backupPath), `${JSON.stringify(manifest, null, 2)}\n`);
  const verification = verifyBrainBackup(backupPath);
  const finalManifest = { ...manifest, verified: verification.verified, verifiedAt: verification.verifiedAt };
  fs.writeFileSync(manifestPath(backupPath), `${JSON.stringify(finalManifest, null, 2)}\n`);
  return finalManifest;
}

function verifyBrainBackup(backupPath) {
  const target = path.resolve(backupPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath(target), "utf8"));
  const errors = [];
  Object.entries(manifest.checksums || {}).forEach(([rel, expected]) => {
    const filePath = path.join(target, rel);
    if (!exists(filePath)) {
      errors.push(`Missing backup file: ${rel}`);
      return;
    }
    const actual = sha256(filePath);
    if (actual !== expected) errors.push(`Checksum mismatch: ${rel}`);
  });
  ["Argentum-Brain/00_System/Manifests/canonical-entities.json", "Argentum-Brain/00_System/Manifests/search-index.json"].forEach((rel) => {
    if (!exists(path.join(target, rel))) errors.push(`Required backup artifact missing: ${rel}`);
  });
  return {
    backupId: manifest.backupId,
    backupPath: target,
    verified: errors.length === 0,
    errors,
    verifiedAt: now(),
    manifest,
  };
}

function restoreDryRun(options = {}) {
  const backupPath = path.resolve(options.backupPath || latestBackup(options.backupRoot));
  const verification = verifyBrainBackup(backupPath);
  const liveVaultPath = path.resolve(options.vaultPath || verification.manifest.vaultPath);
  const backupVaultPath = path.join(backupPath, "Argentum-Brain");
  const liveFiles = walkFiles(liveVaultPath).map((file) => path.relative(liveVaultPath, file).replaceAll(path.sep, "/"));
  const backupFiles = walkFiles(backupVaultPath).map((file) => path.relative(backupVaultPath, file).replaceAll(path.sep, "/"));
  return {
    backupPath,
    liveVaultPath,
    verified: verification.verified,
    wouldReplace: liveFiles.length,
    backupFileCount: backupFiles.length,
    liveOnly: liveFiles.filter((file) => !backupFiles.includes(file)).slice(0, 100),
    backupOnly: backupFiles.filter((file) => !liveFiles.includes(file)).slice(0, 100),
    changesLiveFiles: false,
    errors: verification.errors,
  };
}

function restoreBackup(options = {}) {
  const backupPath = path.resolve(options.backupPath || "");
  const verification = verifyBrainBackup(backupPath);
  if (!verification.verified) {
    const error = new Error("Backup verification failed. Restore blocked.");
    error.status = 409;
    error.details = verification.errors;
    throw error;
  }
  const confirmation = String(options.confirmation || "");
  if (confirmation !== verification.manifest.backupId) {
    const error = new Error("Restore requires confirmation matching the backup ID.");
    error.status = 409;
    throw error;
  }
  const liveVaultPath = path.resolve(options.vaultPath || verification.manifest.vaultPath);
  const safety = createBrainBackup({
    vaultPath: liveVaultPath,
    databasePath: options.databasePath || verification.manifest.databasePath,
    appConfigDir: options.appConfigDir || verification.manifest.appConfigPath,
    backupRoot: options.backupRoot || DEFAULT_BACKUP_ROOT,
  });
  fs.rmSync(liveVaultPath, { recursive: true, force: true });
  fs.cpSync(path.join(backupPath, "Argentum-Brain"), liveVaultPath, { recursive: true });
  return {
    restored: true,
    backupId: verification.manifest.backupId,
    vaultPath: liveVaultPath,
    safetyBackup: safety.backupPath,
  };
}

module.exports = {
  DEFAULT_BACKUP_ROOT,
  createBrainBackup,
  latestBackup,
  restoreBackup,
  restoreDryRun,
  verifyBrainBackup,
};
