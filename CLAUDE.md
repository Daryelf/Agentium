# Claude Code Memory Rules

Argentum OS uses the local Obsidian vault `Argentum-Brain` as the main long-term memory source.

## Long-Term Memory

- Treat Obsidian as the durable project brain.
- Do not create random scattered memory files.
- Update the correct Obsidian note whenever a durable decision, lesson, failure, win, workflow, skill, business status, or agent profile changes.
- Append cleanly under dated sections instead of overwriting existing notes.
- Use Obsidian wiki-links such as `[[Argentum_Master]]`, `[[Agent_1010]]`, and `[[Lessons_Learned]]`.
- Avoid duplicate notes. Search first, append second, create only when no existing note fits.
- Ask before deleting or overwriting notes.

## Safety

- Never store API keys, tokens, passwords, session cookies, private customer credentials, or payment secrets in Obsidian.
- Human approvals may be logged, but private credentials must not be exposed.
- High-risk actions still require Human Gate approval.

## Required Updates

After a major task:

- Update the daily note in `06_Daily_Notes/`.
- Update `05_Memory/Lessons_Learned.md` when there is a reusable lesson.
- Update the related master file when project status changes.
