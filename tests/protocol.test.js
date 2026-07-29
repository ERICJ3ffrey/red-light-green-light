import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUserTransition,
  createRedState,
  detectRelease,
  parseLightArgs,
  parseTransitionMessage,
  renderAuthorityContext,
} from "../runtime/protocol.js";

test("sessions start red", () => {
  assert.deepEqual(createRedState("startup", "2026-07-27T00:00:00.000Z"), {
    mode: "red",
    resetReason: "startup",
    grantedAt: "2026-07-27T00:00:00.000Z",
  });
});

test("green requires a scope", () => {
  assert.deepEqual(parseLightArgs("green"), { ok: false, error: "Green requires a scope." });
});

test("green accepts an optional path allowlist", () => {
  assert.deepEqual(parseLightArgs("green implement auth --paths src/auth.js,tests/auth.test.js"), {
    ok: true,
    transition: {
      mode: "green",
      scope: "implement auth",
      allowedPaths: ["src/auth.js", "tests/auth.test.js"],
    },
  });
});

test("green rejects a paths delimiter without paths", () => {
  const expected = { ok: false, error: "--paths requires at least one path." };
  assert.deepEqual(parseLightArgs("green fix auth --paths"), expected);
  assert.deepEqual(parseLightArgs("  green fix auth --paths   "), expected);
});

test("paths delimiter must be a standalone token", () => {
  assert.deepEqual(parseLightArgs("green fix --pathsfoo"), {
    ok: true,
    transition: { mode: "green", scope: "fix --pathsfoo" },
  });
});

test("yellow accepts an explicit planning path", () => {
  assert.deepEqual(parseLightArgs("yellow docs/plans/auth.md"), {
    ok: true,
    transition: { mode: "yellow", planningPath: "docs/plans/auth.md" },
  });
});

test("pure transition does not consume an agent turn", () => {
  assert.deepEqual(parseTransitionMessage("green light for implement docs/plans/auth.md"), {
    transition: { mode: "green", scope: "implement docs/plans/auth.md" },
    task: "",
  });
});

test("combined transition preserves the task after the first line", () => {
  assert.deepEqual(parseTransitionMessage("green light for implement auth plan\nExecute the approved plan now."), {
    transition: { mode: "green", scope: "implement auth plan" },
    task: "Execute the approved plan now.",
  });
});

test("Codex-style light-first controls share the portable transition contract", () => {
  assert.deepEqual(parseTransitionMessage("light red"), {
    transition: { mode: "red" },
    task: "",
  });
  assert.deepEqual(parseTransitionMessage("light yellow docs/plans"), {
    transition: { mode: "yellow", planningPath: "docs/plans" },
    task: "",
  });
  assert.deepEqual(parseTransitionMessage("light green for implement auth"), {
    transition: { mode: "green", scope: "implement auth" },
    task: "",
  });
  assert.deepEqual(parseTransitionMessage("light status"), { status: true, task: "" });
  assert.deepEqual(parseTransitionMessage("light green"), {
    transition: { mode: "green", scope: "user-enabled Green mode", releasePolicy: "manual" },
    task: "",
  });
});

test("user transition creates scoped green", () => {
  const next = applyUserTransition(createRedState(), { mode: "green", scope: "implement auth plan" }, {
    now: "2026-07-27T01:00:00.000Z",
    userEntry: "entry-1",
  });
  assert.equal(next.mode, "green");
  assert.equal(next.scope, "implement auth plan");
  assert.equal(next.scopeEnforcement, "semantic");
  assert.equal(next.grantedByUserEntry, "entry-1");
});

test("user transition rejects an unknown mode", () => {
  assert.throws(
    () => applyUserTransition(createRedState(), { mode: "bluish" }),
    /Unknown light mode: bluish/,
  );
});

test("release markers only reduce green to red", () => {
  assert.equal(detectRelease("Finished.\nLIGHT_RELEASE: complete"), "complete");
  assert.equal(detectRelease("Need a decision.\nLIGHT_RELEASE: blocked"), "blocked");
  assert.equal(detectRelease("Still implementing."), undefined);
});

test("release marker must be at the end of the entire output", () => {
  assert.equal(detectRelease("LIGHT_RELEASE: complete\nI will continue working."), undefined);
  assert.equal(detectRelease("Finished.\nLIGHT_RELEASE: complete  \n\t"), "complete");
});

test("manual Green remains user-controlled instead of requesting automatic release", () => {
  const state = applyUserTransition(createRedState(), {
    mode: "green",
    scope: "user-enabled Green mode",
    releasePolicy: "manual",
  });
  assert.equal(state.releasePolicy, "manual");
  const text = renderAuthorityContext(state);
  assert.match(text, /remains Green until the user changes the light/i);
  assert.doesNotMatch(text, /LIGHT_RELEASE: complete/);
});

test("authority context repeats mode, scope, and protected-action boundary", () => {
  const text = renderAuthorityContext({
    mode: "green",
    scope: "implement auth plan",
    scopeEnforcement: "semantic",
  });
  assert.match(text, /GREEN/);
  assert.match(text, /implement auth plan/);
  assert.match(text, /LIGHT_RELEASE/);
  assert.match(text, /protected actions remain blocked/i);
  assert.match(renderAuthorityContext({ mode: "red" }), /separate user-controlled channel/i);
});

test("unknown authority modes fail closed to red", () => {
  const text = renderAuthorityContext({ mode: "bluish", scope: "anything" });
  assert.match(text, /RED/);
  assert.match(text, /Read, research, and discuss only/);
  assert.doesNotMatch(text, /Authorized scope/);
});

test("path-bound green authority context lists every allowed path", () => {
  const text = renderAuthorityContext({
    mode: "green",
    scope: "implement auth",
    scopeEnforcement: "path-bound",
    allowedPaths: ["src/auth.js", "tests/auth.test.js"],
  });
  assert.match(text, /Allowed paths: src\/auth\.js, tests\/auth\.test\.js/);
});
