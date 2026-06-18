import assert from "node:assert/strict";
import {
  checkLaunchReadiness,
  draftLaunchCopy,
  extractLaunchTasks,
  generateOwnerChecklist
} from "../src/server/agent/tools.js";

const payload = {
  brief: "Launch a team changelog product that turns merged work into customer-ready release notes.",
  audience: "B2B SaaS product teams",
  launchDate: "2026-07-01",
  constraints: "No automatic publishing, privacy review required",
  assets: "Screenshots, demo video, changelog template",
  channels: "Email, blog, LinkedIn",
  owners: "Engineering, Product, Marketing, Support"
};

const tasks = extractLaunchTasks(payload);
assert.ok(tasks.tasks.length >= 5, "expected prioritized tasks");
assert.ok(tasks.channels.includes("Email"), "expected channels to include Email");

const readiness = checkLaunchReadiness(payload);
assert.ok(readiness.readinessScore > 0, "expected readiness score");
assert.ok(readiness.risks.length >= 1, "expected at least one risk item");

const checklist = generateOwnerChecklist(payload);
assert.ok(checklist.checklists.some((item) => item.owner === "Engineering"), "expected engineering checklist");

const copy = draftLaunchCopy(payload);
assert.ok(copy.copy.some((item) => item.channel === "Email"), "expected channel copy");

console.log("tool contract checks passed");
