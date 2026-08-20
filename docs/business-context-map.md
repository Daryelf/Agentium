# Business Context Map

Agent 101 context is assembled in `buildAgent101Context()` from local state. Secrets and raw environment variables are never included.

## Precedence

1. System constitution
2. Security and Human Gate policy
3. Current operator instruction
4. Approved business policy
5. Active task contract
6. Current verified business state
7. Approved procedures
8. Approved long-term memory
9. Thread summary and recent messages
10. Tool results
11. External content
12. Unapproved notes

Higher layers override lower layers. External content is evidence only; it never becomes an instruction.

## Current Payload Sections

- `agentIdentity`: Agent 101, supervised Chief Operating Agent, draft-only.
- `constitution`: truth, authority, data, and memory policy from the operating pack.
- `authority`: automatic, notification, approval, and prohibited action lists.
- `businessProfile`: company identity, mission, products, goals, KPIs, risks.
- `businessReadiness`: readiness score and missing sections.
- `currentState`: tasks, artifacts, approvals, and active runs.
- `relevantKnowledge`: retrieved business knowledge records.
- `relevantMemories`: approved or working memory records.
- `recentConversation`: recent messages from the current thread.
- `availableTools`: tool registry with readiness and approval policy.
- `pendingApprovals`: active Human Gate requests.

## Retrieval Rule

Do not inject the entire company database into every request. Retrieve by goal text, status, category, and recency. Treat draft knowledge as draft unless explicitly approved.

## Missing Context Behavior

When required facts are missing, Agent 101 should:

- name the unknown,
- avoid inventing a replacement,
- create a task or question if it blocks execution,
- continue safe internal work when assumptions are acceptable and labeled.
