#!/usr/bin/env node
const os = require("node:os");
const path = require("node:path");

const localDatabase = require("../services/local-database");
const localRuntime = require("../services/local-runtime");
const obsidianVault = require("../services/obsidian-vault");

function dataDir() {
  const env = { ...process.env, APP_MODE: process.env.APP_MODE || "local" };
  return localRuntime.resolveDataDir(path.resolve(__dirname, ".."), env);
}

function configuredVaultPath() {
  const dir = dataDir();
  localDatabase.initializeLocalDatabase(dir);
  return localDatabase.getLocalSetting(dir, "obsidianVaultPath", "") || obsidianVault.defaultVaultPath();
}

function saveVaultPath(vaultPath) {
  const dir = dataDir();
  localDatabase.initializeLocalDatabase(dir);
  localDatabase.setLocalSetting(dir, "obsidianVaultPath", vaultPath);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const command = process.argv[2] || "status";
  const inputPath = process.argv[3] || process.env.OBSIDIAN_VAULT_PATH || configuredVaultPath();
  const vaultPath = path.resolve(String(inputPath).replace(/^~(?=$|\/)/, os.homedir()));

  if (command === "init") {
    saveVaultPath(vaultPath);
    print(obsidianVault.initializeVault(vaultPath));
    return;
  }

  if (command === "migrate") {
    saveVaultPath(vaultPath);
    print(obsidianVault.migrateLegacyVault(vaultPath));
    return;
  }

  if (command === "migrate:dry-run" || command === "dry-run") {
    print(obsidianVault.migrateLegacyVault(vaultPath, { dryRun: true }));
    return;
  }

  if (command === "validate") {
    print(obsidianVault.validateVault(vaultPath));
    return;
  }

  if (command === "reindex") {
    print(obsidianVault.rebuildIndexes(vaultPath));
    return;
  }

  if (command === "status") {
    print(obsidianVault.getVaultStatus(vaultPath));
    return;
  }

  process.stderr.write(`Unknown vault command: ${command}\n`);
  process.exitCode = 1;
}

main();
