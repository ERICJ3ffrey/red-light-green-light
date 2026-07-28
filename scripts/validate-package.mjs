import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const errors = [];

for (const relative of [...pkg.pi.skills, ...pkg.pi.extensions]) {
  if (!existsSync(resolve(root, relative))) errors.push(`missing package path: ${relative}`);
}

const skillPath = resolve(root, "skills/red-light-green-light/SKILL.md");
const skill = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
if (!skill.startsWith("---\n")) errors.push("SKILL.md missing opening frontmatter");
if (!/^name: red-light-green-light$/m.test(skill)) errors.push("SKILL.md name mismatch");
if (!/^description: \S.+$/m.test(skill)) errors.push("SKILL.md description missing");
if (skill.split("\n").length > 500) errors.push("SKILL.md exceeds 500 lines");

if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exit(1);
}

console.log(`validated ${pkg.name}@${pkg.version}`);
