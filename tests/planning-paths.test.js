import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPlanningRoots, isAllowedPlanningWrite, isAllowedScopedWrite } from "../runtime/planning-paths.js";

const cwd = "/repo";

function withSymlinkFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rlgl-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "scope"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const outsideFile = join(outside, "victim.md");
  writeFileSync(outsideFile, "outside");

  try {
    symlinkSync(outsideFile, join(repo, "docs", "file-link.md"), "file");
    symlinkSync(outsideFile, join(repo, "scope", "file-link.md"), "file");
    symlinkSync(outside, join(repo, "docs", "parent-link"), "dir");
    symlinkSync(outside, join(repo, "scope", "parent-link"), "dir");
    symlinkSync(outside, join(repo, "scope-link"), "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`symlinks unavailable: ${error.code}`);
      return null;
    }
    throw error;
  }
  return { repo };
}

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

test("lexical traversal outside roots stays denied", () => {
  const roots = buildPlanningRoots(cwd, []);
  assert.equal(isAllowedPlanningWrite("/repo/docs/../../outside/plan.md", roots), false);
  assert.equal(isAllowedScopedWrite("/repo/scope/../../outside/file.md", cwd, ["scope"]), false);
});

test("Yellow planning roots deny existing-file symlink escapes", (t) => {
  const fixture = withSymlinkFixture(t);
  if (!fixture) return;
  const roots = buildPlanningRoots(fixture.repo, []);
  assert.equal(isAllowedPlanningWrite(join(fixture.repo, "docs", "file-link.md"), roots), false);
});

test("Yellow planning roots deny symlinked-parent nonexistent-target escapes", (t) => {
  const fixture = withSymlinkFixture(t);
  if (!fixture) return;
  const roots = buildPlanningRoots(fixture.repo, []);
  assert.equal(isAllowedPlanningWrite(join(fixture.repo, "docs", "parent-link", "new-plan.md"), roots), false);
});

test("Yellow denies default and relative explicit roots that directly symlink outside cwd", (t) => {
  const root = mkdtempSync(join(tmpdir(), "rlgl-root-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  mkdirSync(repo, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "auth-plan.md"), "outside");

  try {
    symlinkSync(outside, join(repo, "docs"), "dir");
    symlinkSync(outside, join(repo, "scope-link"), "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.equal(isAllowedPlanningWrite(join(repo, "docs", "auth-plan.md"), buildPlanningRoots(repo, [])), false);
  assert.equal(isAllowedPlanningWrite(join(repo, "scope-link", "auth-plan.md"), buildPlanningRoots(repo, ["scope-link"])), false);
});

test("path-bound Green denies existing-file symlink escapes", (t) => {
  const fixture = withSymlinkFixture(t);
  if (!fixture) return;
  assert.equal(isAllowedScopedWrite(join(fixture.repo, "scope", "file-link.md"), fixture.repo, ["scope"]), false);
});

test("path-bound Green denies symlinked-parent nonexistent-target escapes", (t) => {
  const fixture = withSymlinkFixture(t);
  if (!fixture) return;
  assert.equal(isAllowedScopedWrite(join(fixture.repo, "scope", "parent-link", "new.md"), fixture.repo, ["scope"]), false);
});

test("path-bound Green denies a relative allowlist root that directly symlinks outside cwd", (t) => {
  const fixture = withSymlinkFixture(t);
  if (!fixture) return;
  assert.equal(isAllowedScopedWrite(join(fixture.repo, "scope-link", "new.md"), fixture.repo, ["scope-link"]), false);
});
