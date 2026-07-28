import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { validateSkillText } from "../scripts/validate-package.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package declares Pi skill and extension resources", () => {
  assert.equal(pkg.name, "red-light-green-light");
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.deepEqual(pkg.pi.extensions, ["./.pi/extensions/red-light-green-light.ts"]);
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
