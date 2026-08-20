#!/usr/bin/env node
const path = require("node:path");

const gatewayAdapter = require("../services/gateway-adapter");
const localRuntime = require("../services/local-runtime");

function dataDir() {
  return localRuntime.resolveDataDir(path.resolve(__dirname, ".."), { ...process.env, APP_MODE: process.env.APP_MODE || "local" });
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fakeReq(token) {
  return { headers: { authorization: `Bearer ${token}`, "x-request-id": "openclaw-bridge-cli" } };
}

function main() {
  const command = process.argv[2] || "check";
  const dir = dataDir();
  if (command === "check") {
    print({
      bridge: gatewayAdapter.bridgeConfig(process.env),
      credentials: gatewayAdapter.listGatewayCredentials(dir),
      boundary: {
        directVaultAccess: false,
        directToolExecution: false,
        approvalDecisions: false,
        adapterOnly: true,
      },
    });
    return;
  }
  if (command === "test") {
    const config = gatewayAdapter.bridgeConfig({ ...process.env, OPENCLAW_BRIDGE_ENABLED: "true", OPENCLAW_BRIDGE_MODE: "test" });
    if (config.mode !== "test") throw new Error("OpenClaw bridge test must run in test mode.");
    const created = gatewayAdapter.createGatewayCredential(dir, { name: "OpenClaw Test Gateway", scopes: gatewayAdapter.SAFE_SCOPES });
    const healthAuth = gatewayAdapter.assertGatewayAuth(dir, fakeReq(created.token), gatewayAdapter.REQUIRED_SCOPES.health);
    const memoryAuth = gatewayAdapter.assertGatewayAuth(dir, fakeReq(created.token), gatewayAdapter.REQUIRED_SCOPES.memorySearch);
    const revoked = gatewayAdapter.revokeGatewayCredential(dir, created.credential.id);
    let revokedRejected = false;
    try {
      gatewayAdapter.assertGatewayAuth(dir, fakeReq(created.token), gatewayAdapter.REQUIRED_SCOPES.health);
    } catch {
      revokedRejected = true;
    }
    print({
      mode: config.mode,
      credentialCreated: created.credential.id,
      healthAuthenticated: Boolean(healthAuth.credential.id),
      memorySearchAuthenticated: Boolean(memoryAuth.credential.id),
      revoked: revoked.status === "revoked",
      revokedRejected,
      vaultWritableByBridge: false,
      toolExecutionByBridge: false,
      approvalDecisionByBridge: false,
    });
    return;
  }
  if (command === "disable") {
    const credentials = gatewayAdapter.listGatewayCredentials(dir).filter((credential) => credential.status === "active");
    const revoked = credentials.map((credential) => gatewayAdapter.revokeGatewayCredential(dir, credential.id));
    print({ disabled: true, revoked: revoked.map((credential) => credential.id) });
    return;
  }
  throw new Error(`Unknown OpenClaw bridge command: ${command}`);
}

main();
