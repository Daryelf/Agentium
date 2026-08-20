#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const distDir = path.resolve(__dirname, "..", "dist");

if (!fs.existsSync(distDir)) {
  process.exit(0);
}

const artifactPaths = fs
  .readdirSync(distDir)
  .filter((name) => name.endsWith(".dmg"))
  .map((name) => path.join(distDir, name));

for (const artifactPath of artifactPaths) {
  const artifact = path.basename(artifactPath);
  const normalizedArtifact = artifact.replace(/-mac\.dmg$/i, ".dmg");

  if (normalizedArtifact === artifact) {
    const macArtifact = artifact.replace(/\.dmg$/, "-mac.dmg");
    const macPath = path.join(distDir, macArtifact);

    const sourceStat = fs.statSync(artifactPath);
    const targetStat = fs.existsSync(macPath) ? fs.statSync(macPath) : null;
    if (!targetStat || targetStat.size !== sourceStat.size || targetStat.mtimeMs < sourceStat.mtimeMs) {
      fs.copyFileSync(artifactPath, macPath);
    }
  }
}
