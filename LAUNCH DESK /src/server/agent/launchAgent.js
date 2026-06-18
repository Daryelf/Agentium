import { Agent, Runner, setTracingDisabled } from "@openai/agents";
import { assertOpenAiReady, getConfig } from "../config.js";
import { launchTools } from "./tools.js";

export function buildLaunchPrompt(payload) {
  return [
    "Create a launch plan from this intake.",
    "",
    `Product brief: ${payload.brief || "(missing)"}`,
    `Audience: ${payload.audience || "(missing)"}`,
    `Launch date: ${payload.launchDate || "(missing)"}`,
    `Constraints: ${payload.constraints || "(missing)"}`,
    `Available assets: ${payload.assets || "(missing)"}`,
    `Channels: ${payload.channels || "(infer)"}`,
    `Owners: ${payload.owners || "(infer)"}`
  ].join("\n");
}

export function createLaunchPlannerAgent(config = getConfig()) {
  setTracingDisabled(!config.traceEnabled);

  return new Agent({
    name: "Launch Desk Planner",
    model: config.model,
    instructions: `
You are Launch Desk, a production-minded release planning agent for engineering teams.

You must turn rough launch ideas into clear, owner-ready release plans. Before your final answer,
use the available tools to:
1. extract launch tasks,
2. check launch readiness,
3. generate owner checklists,
4. draft channel-specific launch copy.

Be concise, practical, and explicit about risk. If key details are missing, ask follow-up questions
instead of inventing facts. Keep the response actionable and easy to hand to a launch team.

Return the final response in these exact sections:
- Prioritized plan
- Risk register
- Owner checklist
- Launch copy suggestions
- Follow-up questions

Do not claim an external approval, deployment, customer contact, or spend happened. This planner can
prepare recommendations only.
    `.trim(),
    tools: launchTools,
    toolUseBehavior: "run_llm_again",
    modelSettings: {
      parallelToolCalls: true
    }
  });
}

export function createRunOptions(trace) {
  return {
    stream: true,
    maxTurns: 6
  };
}

export function createRunnerConfig(trace) {
  return {
    tracingDisabled: !getConfig().traceEnabled,
    traceIncludeSensitiveData: false,
    workflowName: "Launch Desk Planning Run",
    traceId: trace.traceId,
    groupId: "launch-desk-local",
    traceMetadata: Object.fromEntries(
      Object.entries(trace.metadata).map(([key, value]) => [key, String(value)])
    )
  };
}

export async function runLaunchPlanner(payload, trace) {
  assertOpenAiReady();
  const agent = createLaunchPlannerAgent();
  const runner = new Runner(createRunnerConfig(trace));
  return runner.run(agent, buildLaunchPrompt(payload), createRunOptions(trace));
}
