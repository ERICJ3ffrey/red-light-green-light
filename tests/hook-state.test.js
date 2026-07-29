import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  loadSession,
  resetSession,
  saveSession,
  sessionFile,
} from "../hooks/lib/state-store.mjs";

const NOW = "2026-07-28T00:00:00.000Z";

async function tempDataDir(prefix = "rlgl-hook-state-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function expectedStartupRed(now = NOW) {
  return { mode: "red", resetReason: "startup", grantedAt: now };
}

test("sessionFile uses deterministic unique SHA-256 filenames inside the data directory", async () => {
  const dataDir = await tempDataDir();
  const first = sessionFile(dataDir, "session/one");
  const repeated = sessionFile(dataDir, "session/one");
  const second = sessionFile(dataDir, "../session/two");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.equal(dirname(first), resolve(dataDir));
  assert.equal(dirname(second), resolve(dataDir));
  assert.match(basename(first), /^[a-f0-9]{64}\.json$/);
  assert.doesNotMatch(first, /session[\\/]one/);
});

test("saveSession creates the data directory and round-trips valid Red, Yellow, and Green states", async () => {
  const root = await tempDataDir();
  const states = [
    { mode: "red", resetReason: "startup", grantedAt: NOW },
    { mode: "yellow", planningPaths: ["docs/plans"], grantedAt: NOW, grantedByUserEntry: "u-1" },
    {
      mode: "green",
      scope: "edit the hook state store",
      scopeEnforcement: "semantic",
      grantedAt: NOW,
      grantedByUserEntry: "u-2",
    },
    {
      mode: "green",
      scope: "edit approved paths",
      scopeEnforcement: "path-bound",
      allowedPaths: ["hooks/lib", "tests/hook-state.test.js"],
      grantedAt: NOW,
      grantedByUserEntry: "u-3",
    },
  ];

  for (const [index, state] of states.entries()) {
    const dataDir = join(root, `nested/${index}`);
    await saveSession({ dataDir, sessionId: `session-${index}`, state });
    assert.deepEqual(await loadSession({ dataDir, sessionId: `session-${index}`, now: "unused" }), state);
  }
});

test("loadSession preserves valid compacted-session authority", async () => {
  const dataDir = await tempDataDir();
  const compacted = {
    mode: "green",
    scope: "finish approved Task 2",
    scopeEnforcement: "path-bound",
    allowedPaths: ["hooks/lib/state-store.mjs", "tests/hook-state.test.js"],
    grantedAt: NOW,
    grantedByUserEntry: "prompt-7",
  };

  await saveSession({ dataDir, sessionId: "compact-session", state: compacted });

  assert.deepEqual(await loadSession({ dataDir, sessionId: "compact-session", now: "later" }), compacted);
});

test("resetSession writes Red state for startup, resume, clear, and fork reasons", async () => {
  const dataDir = await tempDataDir();

  for (const reason of ["startup", "resume", "clear", "fork"]) {
    const sessionId = `reset-${reason}`;
    const expected = { mode: "red", resetReason: reason, grantedAt: NOW };
    assert.deepEqual(await resetSession({ dataDir, sessionId, reason, now: NOW }), expected);
    assert.deepEqual(await loadSession({ dataDir, sessionId, now: "unused" }), expected);
  }
});

test("loadSession fails closed on missing, unreadable, invalid JSON, invalid shape, secret-bearing, and path errors", async () => {
  const dataDir = await tempDataDir();

  assert.deepEqual(
    await loadSession({ dataDir, sessionId: "missing", now: NOW }),
    expectedStartupRed(),
  );

  await writeFile(sessionFile(dataDir, "invalid-json"), "{not-json\n", "utf8");
  assert.deepEqual(
    await loadSession({ dataDir, sessionId: "invalid-json", now: NOW }),
    expectedStartupRed(),
  );

  await writeFile(sessionFile(dataDir, "invalid-shape"), JSON.stringify({ mode: "green" }), "utf8");
  assert.deepEqual(
    await loadSession({ dataDir, sessionId: "invalid-shape", now: NOW }),
    expectedStartupRed(),
  );

  await writeFile(
    sessionFile(dataDir, "secret-bearing"),
    JSON.stringify({ mode: "red", resetReason: "startup", grantedAt: NOW, apiKey: "secret" }),
    "utf8",
  );
  assert.deepEqual(
    await loadSession({ dataDir, sessionId: "secret-bearing", now: NOW }),
    expectedStartupRed(),
  );

  const unreadablePath = sessionFile(dataDir, "unreadable");
  await mkdir(unreadablePath);
  assert.deepEqual(
    await loadSession({ dataDir, sessionId: "unreadable", now: NOW }),
    expectedStartupRed(),
  );

  assert.deepEqual(
    await loadSession({ dataDir: undefined, sessionId: "bad-path", now: NOW }),
    expectedStartupRed(),
  );
});

test("saveSession atomically replaces state without leaving temporary files", async () => {
  const dataDir = await tempDataDir();
  const sessionId = "replace-me";
  const first = { mode: "yellow", planningPaths: [], grantedAt: NOW };
  const second = {
    mode: "green",
    scope: "replacement",
    scopeEnforcement: "semantic",
    grantedAt: "2026-07-28T01:00:00.000Z",
  };

  await saveSession({ dataDir, sessionId, state: first });
  await saveSession({ dataDir, sessionId, state: second });

  assert.deepEqual(JSON.parse(await readFile(sessionFile(dataDir, sessionId), "utf8")), second);
  assert.deepEqual(await readdir(dataDir), [basename(sessionFile(dataDir, sessionId))]);
});

test("saveSession rejects invalid or secret-bearing state and propagates filesystem errors", async () => {
  const dataDir = await tempDataDir();

  await assert.rejects(
    saveSession({
      dataDir,
      sessionId: "secret",
      state: { mode: "red", resetReason: "startup", grantedAt: NOW, token: "do-not-store" },
    }),
    /invalid session state/,
  );

  const inheritedSerializer = Object.assign(
    Object.create({
      toJSON: () => ({ mode: "red", resetReason: "startup", grantedAt: NOW, token: "smuggled" }),
    }),
    { mode: "red", resetReason: "startup", grantedAt: NOW },
  );
  await assert.rejects(
    saveSession({ dataDir, sessionId: "inherited-serializer", state: inheritedSerializer }),
    /invalid session state/,
  );

  const notADirectory = join(dataDir, "not-a-directory");
  await writeFile(notADirectory, "occupied", "utf8");
  await assert.rejects(
    saveSession({
      dataDir: notADirectory,
      sessionId: "write-failure",
      state: { mode: "red", resetReason: "startup", grantedAt: NOW },
    }),
  );
});
