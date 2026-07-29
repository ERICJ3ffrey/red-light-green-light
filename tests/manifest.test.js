import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseJsonFile,
  validateComponentPath,
  validateNativeManifests,
} from "../scripts/validate-package.mjs";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const readJson = (relative) => JSON.parse(readFileSync(join(packageRoot, relative), "utf8"));

function createNativeManifestFixture(version) {
  const root = mkdtempSync(join(tmpdir(), "rlgl-native-manifests-"));
  for (const relative of [".claude-plugin", ".codex-plugin", ".agents/plugins", "hooks", "skills"]) {
    mkdirSync(join(root, relative), { recursive: true });
  }
  const writeJson = (relative, value) => {
    writeFileSync(join(root, relative), `${JSON.stringify(value)}\n`);
  };

  writeJson("package.json", { name: "red-light-green-light", version });
  writeJson("hooks/hooks.json", {});
  writeJson(".claude-plugin/plugin.json", {
    name: "red-light-green-light",
    version,
    hooks: "./hooks/hooks.json",
  });
  writeJson(".claude-plugin/marketplace.json", {
    name: "red-light-green-light",
    plugins: [{ name: "red-light-green-light", version }],
  });
  writeJson(".codex-plugin/plugin.json", {
    name: "red-light-green-light",
    version,
    skills: "./skills/",
    hooks: "./hooks/hooks.json",
  });
  writeJson(".agents/plugins/marketplace.json", {
    name: "red-light-green-light",
    plugins: [{ name: "red-light-green-light" }],
  });

  return root;
}

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

test("manifest JSON parsing reports malformed files without throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "rlgl-manifest-json-"));
  const path = join(root, "broken.json");
  writeFileSync(path, "{ not-json }\n");

  const result = parseJsonFile(path);

  assert.equal(result.value, null);
  assert.match(result.errors.join("\n"), /invalid JSON/);
});

test("Claude manifest and marketplace expose the v0.2 adapter", () => {
  const plugin = readJson(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "red-light-green-light");
  assert.equal(plugin.version, "0.2.0");
  assert.equal(
    plugin.description,
    "User-controlled Red, Yellow, and scoped Green authority for AI coding agents",
  );
  assert.deepEqual(plugin.author, {
    name: "ERICJ3ffrey",
    url: "https://github.com/ERICJ3ffrey",
  });
  assert.equal(plugin.hooks, "./hooks/hooks.json");

  const marketplace = readJson(".claude-plugin/marketplace.json");
  assert.equal(
    marketplace.$schema,
    "https://json.schemastore.org/claude-code-marketplace.json",
  );
  assert.equal(marketplace.name, "red-light-green-light");
  assert.deepEqual(marketplace.owner, {
    name: "ERICJ3ffrey",
    url: "https://github.com/ERICJ3ffrey",
  });
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "red-light-green-light");
  assert.equal(marketplace.plugins[0].version, "0.2.0");
  assert.equal(marketplace.plugins[0].source, "./");
  assert.equal(marketplace.plugins[0].category, "productivity");
});

test("Codex manifest is rich, text-only, and points to packaged components", () => {
  const plugin = readJson(".codex-plugin/plugin.json");
  assert.equal(plugin.name, "red-light-green-light");
  assert.equal(plugin.version, "0.2.0");
  assert.equal(
    plugin.description,
    "User-controlled Red, Yellow, and scoped Green authority for AI coding agents",
  );
  assert.deepEqual(plugin.author, {
    name: "ERICJ3ffrey",
    url: "https://github.com/ERICJ3ffrey",
  });
  assert.equal(plugin.homepage, "https://github.com/ERICJ3ffrey/red-light-green-light#readme");
  assert.equal(plugin.repository, "https://github.com/ERICJ3ffrey/red-light-green-light.git");
  assert.equal(plugin.license, "MIT");
  assert.ok(plugin.keywords.includes("agent-skills"));
  assert.equal(plugin.skills, "./skills/");
  assert.equal(plugin.hooks, "./hooks/hooks.json");
  assert.deepEqual(plugin.interface.capabilities, ["Instructions", "Lifecycle hooks"]);
  assert.equal(plugin.interface.displayName, "Red Light Green Light");
  assert.equal(typeof plugin.interface.shortDescription, "string");
  assert.ok(plugin.interface.shortDescription.length > 0);
  assert.equal(typeof plugin.interface.longDescription, "string");
  assert.ok(plugin.interface.longDescription.length > 0);
  assert.equal(plugin.interface.developerName, "ERICJ3ffrey");
  assert.equal(plugin.interface.category, "Productivity");
  assert.equal(
    plugin.interface.websiteURL,
    "https://github.com/ERICJ3ffrey/red-light-green-light",
  );
  assert.ok(Array.isArray(plugin.interface.defaultPrompt));
  assert.ok(plugin.interface.defaultPrompt.length > 0);
  assert.match(plugin.interface.brandColor, /^#[0-9A-F]{6}$/);
  for (const omitted of [
    "composerIcon",
    "logo",
    "logoDark",
    "screenshots",
    "privacyPolicyURL",
    "termsOfServiceURL",
  ]) {
    assert.equal(omitted in plugin.interface, false, `${omitted} must be omitted without a real asset`);
  }
});

test("Codex marketplace installs the release branch Git source on demand", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  assert.equal(marketplace.name, "red-light-green-light");
  assert.equal(marketplace.interface.displayName, "Red Light Green Light");
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, "red-light-green-light");
  assert.deepEqual(entry.source, {
    source: "url",
    url: "https://github.com/ERICJ3ffrey/red-light-green-light.git",
    ref: "master",
  });
  assert.deepEqual(entry.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(entry.category, "Productivity");
});

test("native manifest validation accepts versions and component paths", () => {
  assert.deepEqual(validateNativeManifests(packageRoot), []);
});

test("native manifest validation derives the release version from package.json", () => {
  const root = createNativeManifestFixture("9.8.7");

  assert.deepEqual(validateNativeManifests(root), []);
});

test("native manifest validation fails closed for missing or invalid package metadata", () => {
  const missingRoot = mkdtempSync(join(tmpdir(), "rlgl-missing-package-"));
  assert.match(validateNativeManifests(missingRoot).join("\n"), /missing JSON file: .*package\.json/);

  const invalidJsonRoot = createNativeManifestFixture("0.2.0");
  writeFileSync(join(invalidJsonRoot, "package.json"), "{ not-json }\n");
  assert.match(validateNativeManifests(invalidJsonRoot).join("\n"), /invalid JSON in .*package\.json/);

  const missingVersionRoot = createNativeManifestFixture("0.2.0");
  writeFileSync(
    join(missingVersionRoot, "package.json"),
    `${JSON.stringify({ name: "red-light-green-light" })}\n`,
  );
  assert.match(
    validateNativeManifests(missingVersionRoot).join("\n"),
    /package version must be a non-empty string/,
  );
});

test("Claude flat command forwards arguments without copying the protocol", () => {
  const command = readFileSync(join(packageRoot, "commands/light.md"), "utf8").replace(/\r\n/g, "\n");
  assert.match(command, /^---\n/);
  assert.match(command, /\ndescription: \S.+\n/);
  assert.match(command, /\nargument-hint: \S.+\n/);
  assert.match(command, /\n---\n/);
  assert.match(command, /`\/light \$ARGUMENTS`/);
  assert.match(command, /pure transition/i);
  assert.match(command, /perform no task/i);
  assert.ok(command.split("\n").length <= 12, "command must stay thin");
  assert.doesNotMatch(command, /Path-bound Green|Semantic Green|Protected actions/);
});
