# Launch Desk Validation Checklist

## Agent Behavior

- [ ] Agent uses launch tools before final answer.
- [ ] Response includes prioritized plan, risk register, owner checklist, launch copy suggestions, and follow-up questions.
- [ ] Missing audience, date, assets, or constraints produce follow-up questions.
- [ ] Agent does not claim it deployed, contacted customers, spent money, or published externally.

## Frontend Flow

- [ ] User can enter product brief, audience, date, constraints, assets, channels, and owners.
- [ ] Sample brief fills the form.
- [ ] Run button disables while the stream is active.
- [ ] Progress timeline shows route/tool/model updates.
- [ ] Output panel receives model text progressively.
- [ ] Friendly missing-key or billing/quota errors are shown without exposing secrets.

## Tool Outputs

- [ ] `extract_launch_tasks` returns at least five actionable tasks.
- [ ] `check_launch_readiness` returns score, rating, rubric, and risks.
- [ ] `generate_owner_checklist` returns owner-specific work.
- [ ] `draft_channel_launch_copy` returns copy per inferred or provided channel.

## Security

- [ ] No frontend file contains `OPENAI_API_KEY` or bearer tokens.
- [ ] API key exists only in the server environment.
- [ ] `/api/launch/status` returns only safe provider status.

## E2E Streaming

- [ ] Server is started with a real `OPENAI_API_KEY`.
- [ ] `npm run verify:e2e` receives at least one `tool_progress` event.
- [ ] `npm run verify:e2e` receives at least one `text_delta` event.
- [ ] If OpenAI is unreachable, the exact blocker is reported.
