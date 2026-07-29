import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export function validateComponentPath(root, value) {
  const errors = [];
  if (typeof value !== "string" || !value.trim()) return ["component path must be a non-empty string"];
  if (isAbsolute(value)) errors.push(`component path must be relative: ${value}`);
  if (!value.startsWith("./")) errors.push(`component path must start with ./: ${value}`);

  const absolute = resolve(root, value);
  const rel = relative(resolve(root), absolute);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (escapes) errors.push(`component path resolves outside package root: ${value}`);
  if (!escapes && !existsSync(absolute)) errors.push(`missing component path: ${value}`);
  return errors;
}

export function parseJsonFile(path) {
  if (!existsSync(path)) return { value: null, errors: [`missing JSON file: ${path}`] };

  try {
    return { value: JSON.parse(readFileSync(path, "utf8")), errors: [] };
  } catch (error) {
    return { value: null, errors: [`invalid JSON in ${path}: ${error.message}`] };
  }
}

export function validateNativeManifests(root) {
  const expectedName = "red-light-green-light";
  const errors = [];
  const packageResult = parseJsonFile(resolve(root, "package.json"));
  errors.push(...packageResult.errors);
  const expectedVersion = packageResult.value?.version;
  const hasValidPackageVersion = typeof expectedVersion === "string" && expectedVersion.trim() !== "";
  if (packageResult.value && !hasValidPackageVersion) {
    errors.push("package version must be a non-empty string");
  }

  const manifests = {};
  for (const relative of [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
  ]) {
    const result = parseJsonFile(resolve(root, relative));
    errors.push(...result.errors);
    manifests[relative] = result.value;
  }

  const claudePlugin = manifests[".claude-plugin/plugin.json"];
  const claudeMarketplace = manifests[".claude-plugin/marketplace.json"];
  const codexPlugin = manifests[".codex-plugin/plugin.json"];
  const codexMarketplace = manifests[".agents/plugins/marketplace.json"];

  for (const [label, manifest] of [
    ["Claude plugin", claudePlugin],
    ["Codex plugin", codexPlugin],
  ]) {
    if (!manifest) continue;
    if (manifest.name !== expectedName) errors.push(`${label} name must be ${expectedName}`);
    if (hasValidPackageVersion && manifest.version !== expectedVersion) {
      errors.push(`${label} version must be ${expectedVersion}`);
    }
  }

  for (const [label, marketplace] of [
    ["Claude marketplace", claudeMarketplace],
    ["Codex marketplace", codexMarketplace],
  ]) {
    if (!marketplace) continue;
    if (marketplace.name !== expectedName) errors.push(`${label} name must be ${expectedName}`);
    if (marketplace.plugins?.length !== 1 || marketplace.plugins[0]?.name !== expectedName) {
      errors.push(`${label} must contain the ${expectedName} plugin`);
    }
  }

  if (
    hasValidPackageVersion &&
    claudeMarketplace?.plugins?.[0]?.version !== expectedVersion
  ) {
    errors.push(`Claude marketplace plugin version must be ${expectedVersion}`);
  }

  for (const [label, value] of [
    ["Claude hooks", claudePlugin?.hooks],
    ["Codex skills", codexPlugin?.skills],
    ["Codex hooks", codexPlugin?.hooks],
  ]) {
    if (value === undefined) continue;
    errors.push(...validateComponentPath(root, value).map((error) => `${label}: ${error}`));
  }

  return errors;
}

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
  const errors = validateNativeManifests(root);

  for (const relative of [...pkg.pi.skills, ...pkg.pi.extensions]) {
    if (!existsSync(resolve(root, relative))) errors.push(`missing package path: ${relative}`);
  }

  const skillPath = resolve(root, "skills/red-light-green-light/SKILL.md");
  if (existsSync(skillPath)) {
    errors.push(...validateSkillText(readFileSync(skillPath, "utf8")));
  } else {
    errors.push("missing canonical skill: skills/red-light-green-light/SKILL.md");
  }

  for (const relative of [
    "README.md",
    "LICENSE",
    "runtime/protocol.js",
    "runtime/command-policy.js",
    "runtime/planning-paths.js",
  ]) {
    if (!existsSync(resolve(root, relative))) errors.push(`missing release file: ${relative}`);
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
