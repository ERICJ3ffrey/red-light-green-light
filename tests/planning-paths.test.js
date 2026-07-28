import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanningRoots, isAllowedPlanningWrite, isAllowedScopedWrite } from "../runtime/planning-paths.js";

const cwd = "/repo";

test("default planning roots accept markdown planning files", () => {
  const roots = buildPlanningRoots(cwd, []);
  assert.equal(isAllowedPlanningWrite("/repo/docs/plans/auth.md", roots), true);
  assert.equal(isAllowedPlanningWrite("/repo/.superpowers/brainstorm/auth-design.md", roots), true);
});

test("yellow rejects production and test files", () => {
  const roots = buildPlanningRoots(cwd, []);
  assert.equal(isAllowedPlanningWrite("/repo/src/auth.js", roots), false);
  assert.equal(isAllowedPlanningWrite("/repo/tests/auth.test.js", roots), false);
});

test("explicit outside-root planning file must look like a planning artifact", () => {
  const roots = buildPlanningRoots(cwd, ["notes/auth-plan.md"]);
  assert.equal(isAllowedPlanningWrite("/repo/notes/auth-plan.md", roots), true);
  assert.equal(isAllowedPlanningWrite("/repo/notes/auth.js", roots), false);
});

test("path-bound green permits only exact files and descendants", () => {
  assert.equal(isAllowedScopedWrite("/repo/src/auth.js", cwd, ["src/auth.js", "tests/auth"]), true);
  assert.equal(isAllowedScopedWrite("/repo/tests/auth/unit.test.js", cwd, ["src/auth.js", "tests/auth"]), true);
  assert.equal(isAllowedScopedWrite("/repo/package.json", cwd, ["src/auth.js", "tests/auth"]), false);
});
