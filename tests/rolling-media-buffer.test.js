import assert from "node:assert/strict";
import test from "node:test";
import { findRollingRecorderProcesses, selectRecentBufferSegments } from "../CLIPPING OFFICE /services/rolling-media-buffer.js";

test("rolling buffer selects the prior minute and one continuity segment", () => {
  const endAtMs = 1_000_000;
  const segments = Array.from({ length: 30 }, (_, index) => ({
    filePath: `/tmp/${index}.ts`,
    completedAtMs: endAtMs - ((29 - index) * 4_000)
  }));
  const selected = selectRecentBufferSegments(segments, { endAtMs, lookbackSeconds: 60 });

  assert.equal(selected.at(-1).filePath, "/tmp/29.ts");
  assert.equal(selected[0].filePath, "/tmp/13.ts");
  assert.equal(selected.length, 17);
});

test("rolling buffer never selects segments newer than the trigger", () => {
  const selected = selectRecentBufferSegments([
    { filePath: "/tmp/old.ts", completedAtMs: 10_000 },
    { filePath: "/tmp/current.ts", completedAtMs: 20_000 },
    { filePath: "/tmp/future.ts", completedAtMs: 30_000 }
  ], { endAtMs: 20_000, lookbackSeconds: 10 });

  assert.deepEqual(selected.map((segment) => segment.filePath), ["/tmp/old.ts", "/tmp/current.ts"]);
});

test("rolling recorder audit selects only ffmpeg processes writing to this office", () => {
  const marker = "/Users/test/Library/Application Support/Argentum OS/clipping-office/Clips/.staging/rolling";
  const rows = findRollingRecorderProcesses(`
  101     1 /Applications/Argentum OS.app/Contents/Resources/ffmpeg -i live ${marker}/watch_session_a/%Y.ts
  102   999 /Applications/Argentum OS.app/Contents/Resources/ffmpeg -i live /tmp/another-office/%Y.ts
  103     1 /usr/bin/node worker.js ${marker}/watch_session_a
  104     1 /Applications/Argentum OS.app/Contents/Resources/ffmpeg -i live ${marker}/watch_session_b/%Y.ts
  `, marker, 104);

  assert.deepEqual(rows.map((row) => row.pid), [101]);
});
