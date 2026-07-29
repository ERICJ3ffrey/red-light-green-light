import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateComponentPath } from "../scripts/validate-package.mjs";

test("component paths must be package-relative and stay inside the package", () => {
  const root = mkdtempSync(join(tmpdir(), "rlgl-manifest-path-"));
  mkdirSync(join(root, "hooks"));
  writeFileSync(join(root, "hooks", "hooks.json"), "{}\n");

  assert.deepEqual(validateComponentPath(root, "./hooks/hooks.json"), []);
  assert.match(validateComponentPath(root, "hooks/hooks.json").join("\n"), /must start with \.\//);
  assert.match(validateComponentPath(root, "../outside.json").join("\n"), /outside package root/);
  assert.match(validateComponentPath(root, join(root, "hooks", "hooks.json")).join("\n"), /must be relative/);
});

test("component paths reject missing resources", () => {
  const root = mkdtempSync(join(tmpdir(), "rlgl-manifest-missing-"));
  assert.match(validateComponentPath(root, "./hooks/missing.json").join("\n"), /missing component path/);
});
