import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSkillText } from "../scripts/validate-package.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("package declares Pi skill and extension resources", () => {
  assert.equal(pkg.name, "red-light-green-light");
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.deepEqual(pkg.pi.extensions, ["./.pi/extensions/red-light-green-light.ts"]);
  assert.equal(pkg.scripts["acceptance:pi"], "node tests/acceptance/pi/run-acceptance.mjs");
});

test("package limits distributed files to runtime resources", () => {
  assert.deepEqual(pkg.files, [".pi/extensions/", "runtime/", "skills/"]);
});

test("packed package excludes development-only paths", () => {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "& npm pack --dry-run --json"],
          { cwd: packageRoot, encoding: "utf8", shell: false },
        )
      : spawnSync("npm", ["pack", "--dry-run", "--json"], {
          cwd: packageRoot,
          encoding: "utf8",
          shell: false,
        });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const packedPaths = JSON.parse(result.stdout)[0].files.map(({ path }) => path);
  for (const required of [
    ".pi/extensions/red-light-green-light.ts",
    "runtime/command-policy.js",
    "runtime/planning-paths.js",
    "runtime/protocol.js",
    "skills/red-light-green-light/SKILL.md",
    "skills/red-light-green-light/references/enforcement.md",
  ]) assert.ok(packedPaths.includes(required), required);

  for (const path of packedPaths) {
    assert.equal(
      ["tests/", "evals/", "scripts/"].some((prefix) => path.startsWith(prefix)),
      false,
      path,
    );
    assert.notEqual(path, ".gitignore");
  }
});

test("declared package paths exist", () => {
  for (const path of [...pkg.pi.skills, ...pkg.pi.extensions]) {
    assert.equal(existsSync(new URL(`../${path.replace(/^\.\//, "")}`, import.meta.url)), true, path);
  }
});

test("canonical skill frontmatter is portable", () => {
  const path = new URL("../skills/red-light-green-light/SKILL.md", import.meta.url);
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  assert.match(text, /^---\n/);
  assert.match(text, /\nname: red-light-green-light\n/);
  assert.match(text, /\ndescription: .+\n/);
  assert.match(text, /\n---\n/);
});

test("skill validation ignores metadata after closed frontmatter", () => {
  const errors = validateSkillText(`---\n---\nname: red-light-green-light\ndescription: misplaced\n`);

  assert.ok(errors.includes("SKILL.md name mismatch"));
  assert.ok(errors.includes("SKILL.md description missing"));
});

test("skill validation rejects frontmatter after leading prose", () => {
  const errors = validateSkillText(
    `leading prose\n---\nname: red-light-green-light\ndescription: misplaced\n---\n`,
  );

  assert.ok(errors.includes("SKILL.md missing bounded frontmatter"));
});

test("historical RED evidence is labeled as expected and superseded", () => {
  const text = readFileSync(new URL("./evidence/task-2-red.txt", import.meta.url), "utf8");
  assert.match(text, /^HISTORICAL TDD RED EVIDENCE — EXPECTED FAILURE/);
  assert.match(text, /superseded by the passing package suite/);
});

test("README documents Pi install, commands, and enforcement limits", () => {
  const text = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(text, /pi install git:github\.com\/ERICJ3ffrey\/red-light-green-light/);
  assert.match(text, /\/light yellow \[planning-path\]/);
  assert.match(text, /--paths path-one,path-two/);
  assert.match(text, /Path-bound Green/);
  assert.match(text, /Semantic Green/);
  assert.match(text, /instruction guarded/i);
  assert.match(text, /not an OS sandbox/i);
  assert.match(text, /concurrent external/i);
  assert.match(text, /remain blocked even in Green/i);
  assert.match(text, /separate user-controlled channel/i);
});
