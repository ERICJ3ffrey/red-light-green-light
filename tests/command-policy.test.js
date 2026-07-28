import assert from "node:assert/strict";
import test from "node:test";
import { evaluateToolCall, isReadOnlyCommand, isProtectedCommand } from "../runtime/command-policy.js";

const cwd = "/repo";

test("read-only shell permits inspection pipelines", () => {
  assert.equal(isReadOnlyCommand("rg -n auth src | head -20"), true);
  assert.equal(isReadOnlyCommand("git status --short"), true);
});

test("read-only shell rejects redirects, chaining, and mutation", () => {
  assert.equal(isReadOnlyCommand("rg auth src > result.txt"), false);
  assert.equal(isReadOnlyCommand("ls && rm -rf build"), false);
  assert.equal(isReadOnlyCommand("node scripts/fix.js"), false);
});

test("protected commands stay blocked under green", () => {
  assert.equal(isProtectedCommand("git commit -am done"), true);
  assert.equal(isProtectedCommand("npm install lodash"), true);
  assert.equal(isProtectedCommand("npm test"), false);
});

test("red blocks write tools", () => {
  const result = evaluateToolCall({ toolName: "write", input: { path: "/repo/src/auth.js" } }, { mode: "red" }, { cwd });
  assert.equal(result.allow, false);
});

test("yellow permits planning file and blocks source file", () => {
  const state = { mode: "yellow", planningPaths: ["docs/plans"] };
  assert.equal(evaluateToolCall({ toolName: "write", input: { path: "/repo/docs/plans/auth.md" } }, state, { cwd }).allow, true);
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/src/auth.js" } }, state, { cwd }).allow, false);
});

test("path-bound green blocks out-of-scope writes and mutating bash", () => {
  const state = { mode: "green", scope: "auth", scopeEnforcement: "path-bound", allowedPaths: ["src/auth.js"] };
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/src/auth.js" } }, state, { cwd }).allow, true);
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/package.json" } }, state, { cwd }).allow, false);
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "node scripts/rewrite.js" } }, state, { cwd }).allow, false);
});

test("unknown custom tools fail closed", () => {
  assert.equal(evaluateToolCall({ toolName: "mystery_mutator", input: {} }, { mode: "green", scopeEnforcement: "semantic" }, { cwd }).allow, false);
});
