import assert from "node:assert/strict";
import test from "node:test";
import { buildClipChatPrompt, sanitizeClipChatHistory } from "../CLIPPING OFFICE /services/clip-chat.js";

test("clip chat prompt carries real clip evidence and treats it as untrusted", () => {
  const prompt = buildClipChatPrompt({
    candidate: { streamerName: "Clix", category: "IRL", durationSeconds: 30 },
    transcript: "We have been live for 10 hours",
    currentCaption: "they waited all that time for 20 minutes 😭",
    message: "What is actually happening here?",
    history: [{ role: "user", text: "Is this accurate?" }, { role: "assistant", text: "The transcript confirms ten hours." }]
  });
  assert.match(prompt, /untrusted evidence/i);
  assert.match(prompt, /We have been live for 10 hours/);
  assert.match(prompt, /What is actually happening here/);
  assert.match(prompt, /they waited all that time/);
});

test("clip chat history is bounded and only accepts user or assistant roles", () => {
  const history = sanitizeClipChatHistory(Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "system",
    text: `message ${index}`
  })));
  assert.equal(history.length, 12);
  assert.ok(history.every((message) => ["user", "assistant"].includes(message.role)));
});
