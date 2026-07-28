import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateSkillText(text) {
  const skill = text.replace(/\r\n/g, "\n");
  const lines = skill.split("\n");
  const errors = [];
  const closingDelimiter = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const frontmatter = closingDelimiter === -1 ? undefined : lines.slice(1, closingDelimiter).join("\n");

  if (frontmatter === undefined) errors.push("SKILL.md missing bounded frontmatter");
  if (frontmatter === undefined || !/^name: red-light-green-light$/m.test(frontmatter)) {
    errors.push("SKILL.md name mismatch");
  }
  if (frontmatter === undefined || !/^description: \S.*$/m.test(frontmatter)) {
    errors.push("SKILL.md description missing");
  }
  if (lines.length > 500) errors.push("SKILL.md exceeds 500 lines");

  return errors;
}

function validatePackage() {
  const root = resolve(import.meta.dirname, "..");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const errors = [];

  for (const relative of [...pkg.pi.skills, ...pkg.pi.extensions]) {
    if (!existsSync(resolve(root, relative))) errors.push(`missing package path: ${relative}`);
  }

  const skillPath = resolve(root, "skills/red-light-green-light/SKILL.md");
  if (existsSync(skillPath)) {
    errors.push(...validateSkillText(readFileSync(skillPath, "utf8")));
  } else {
    errors.push("missing canonical skill: skills/red-light-green-light/SKILL.md");
  }

  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`validated ${pkg.name}@${pkg.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validatePackage();
}
