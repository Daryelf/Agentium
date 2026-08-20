#!/usr/bin/env node
const path = require("node:path");

const agentContextBuilder = require("../services/agent-context-builder");
const brainBackup = require("../services/brain-backup");
const brainVerification = require("../services/brain-verification");
const localDatabase = require("../services/local-database");
const localRuntime = require("../services/local-runtime");
const obsidianVault = require("../services/obsidian-vault");

function env() {
  return { ...process.env, APP_MODE: process.env.APP_MODE || "local" };
}

function rootDir() {
  return path.resolve(__dirname, "..");
}

function dataDir() {
  return localRuntime.resolveDataDir(rootDir(), env());
}

function configuredVaultPath() {
  const dir = dataDir();
  localDatabase.initializeLocalDatabase(dir);
  return localDatabase.getLocalSetting(dir, "obsidianVaultPath", "") || obsidianVault.defaultVaultPath();
}

function databasePath() {
  return localDatabase.databasePath(dataDir());
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const command = process.argv[2] || "verify";
  const vaultPath = path.resolve(process.env.OBSIDIAN_VAULT_PATH || configuredVaultPath());
  const backupPath = process.argv[3] || process.env.ARGENTUM_BRAIN_BACKUP_PATH || brainBackup.latestBackup();

  if (command === "backup") {
    print(brainBackup.createBrainBackup({ vaultPath, databasePath: databasePath(), appConfigDir: dataDir() }));
    return;
  }
  if (command === "backup:verify") {
    if (!backupPath) throw new Error("No backup path supplied and no backup exists.");
    print(brainBackup.verifyBrainBackup(backupPath));
    return;
  }
  if (command === "restore:dry-run") {
    if (!backupPath) throw new Error("No backup path supplied and no backup exists.");
    print(brainBackup.restoreDryRun({ backupPath, vaultPath }));
    return;
  }
  if (command === "restore") {
    if (!backupPath) throw new Error("Restore requires backup path.");
    print(brainBackup.restoreBackup({ backupPath, vaultPath, databasePath: databasePath(), appConfigDir: dataDir(), confirmation: process.env.CONFIRM_RESTORE || process.argv[4] || "" }));
    return;
  }
  if (command === "verify") {
    print(brainVerification.verifyBrain({
      vaultPath,
      contextBuilder: (payload) => agentContextBuilder.buildAgentContext({ ...payload, vaultPath }),
      backupOptions: process.env.BRAIN_VERIFY_WITH_BACKUP === "1" ? { vaultPath, databasePath: databasePath(), appConfigDir: dataDir() } : null,
      skipBackup: process.env.BRAIN_VERIFY_WITH_BACKUP !== "1",
    }));
    return;
  }
  throw new Error(`Unknown brain command: ${command}`);
}

main();
