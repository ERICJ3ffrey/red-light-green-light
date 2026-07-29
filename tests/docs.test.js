import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("README presents the exact public name, logo, and Git install paths", () => {
  const text = read("README.md");
  assert.match(text, /# red-light-green-light\n/);
  assert.match(text, /assets\/red-light-green-light-logo\.svg/);
  assert.match(text, /pi install git:github\.com\/ERICJ3ffrey\/red-light-green-light/);
  assert.match(text, /claude plugin marketplace add ERICJ3ffrey\/red-light-green-light/);
  assert.match(text, /claude plugin install red-light-green-light@red-light-green-light/);
  assert.match(text, /codex plugin marketplace add ERICJ3ffrey\/red-light-green-light --ref master/);
  assert.match(text, /codex plugin add red-light-green-light@red-light-green-light/);
  assert.doesNotMatch(text, /npm (?:install|i) (?:-g )?red-light-green-light/);
});

test("README states enforcement tiers, hook trust, and protected boundaries", () => {
  const text = read("README.md");
  for (const phrase of [
    "Enforcement matrix",
    "Mechanically guarded",
    "Instruction guarded",
    "explicitly trust them",
    "not an OS sandbox",
    "separate user-controlled channel",
    "Laptop smoke test",
  ]) assert.match(text.toLowerCase(), new RegExp(phrase.toLowerCase()));
});

test("public CI covers Windows and Ubuntu without an install step", () => {
  const text = read(".github/workflows/test.yml");
  assert.match(text, /ubuntu-latest/);
  assert.match(text, /windows-latest/);
  assert.match(text, /node-version: '22'/);
  assert.match(text, /npm test/);
  assert.match(text, /npm run validate/);
  assert.match(text, /npm pack --dry-run --json/);
  assert.doesNotMatch(text, /npm (?:install|ci)/);
});

test("security and contribution policies preserve the enforcement claim boundary", () => {
  const security = read("SECURITY.md");
  const contributing = read("CONTRIBUTING.md");
  assert.match(security, /security\/advisories\/new/);
  assert.match(security, /not an operating-system sandbox/i);
  assert.match(contributing, /test-driven development/i);
  assert.match(contributing, /SKILL\.md.*only/i);
  assert.match(contributing, /fail closed/i);
  assert.match(contributing, /acceptance evidence/i);
});
