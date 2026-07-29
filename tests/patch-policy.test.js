import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePatch, parseApplyPatch } from "../runtime/patch-policy.js";

const cwd = "/repo";
const red = { mode: "red" };
const yellow = { mode: "yellow", planningPaths: ["docs/plans"] };
const semanticGreen = { mode: "green", scope: "Task 3", scopeEnforcement: "semantic" };
const pathGreen = {
  mode: "green",
  scope: "Task 3",
  scopeEnforcement: "path-bound",
  allowedPaths: ["src", "docs/plans"],
};

function patch(...lines) {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

test("parseApplyPatch parses exact add and update directives", () => {
  assert.deepEqual(
    parseApplyPatch(patch("*** Update File: docs/plans/a.md", "@@", "-old", "+new")),
    { ok: true, operations: [{ kind: "update", path: "docs/plans/a.md" }] },
  );

  assert.deepEqual(
    parseApplyPatch(
      patch(
        "*** Add File: docs/plans/new.md",
        "+new plan",
        "*** Update File: src/auth.js",
        "@@",
        "-old",
        "+new",
      ),
    ),
    {
      ok: true,
      operations: [
        { kind: "add", path: "docs/plans/new.md" },
        { kind: "update", path: "src/auth.js" },
      ],
    },
  );
});

test("parseApplyPatch accepts CRLF envelopes and one final newline", () => {
  const command = `${patch("*** Add File: docs/plans/a.md", "+content")}\n`.replaceAll("\n", "\r\n");
  assert.deepEqual(parseApplyPatch(command), {
    ok: true,
    operations: [{ kind: "add", path: "docs/plans/a.md" }],
  });
});

test("a move authorizes both the update source and destination", () => {
  assert.deepEqual(
    parseApplyPatch(
      patch(
        "*** Update File: src/old.js",
        "*** Move to: src/new.js",
        "@@",
        "-old",
        "+new",
      ),
    ),
    {
      ok: true,
      operations: [
        { kind: "update", path: "src/old.js" },
        { kind: "update", path: "src/new.js" },
      ],
    },
  );
});

test("parseApplyPatch rejects deletion, unsupported, malformed, and empty envelopes", () => {
  for (const command of [
    patch("*** Delete File: src/a.js"),
    patch("*** Copy File: src/a.js", "+content"),
    patch("content before a directive", "*** Add File: src/a.js", "+content"),
    patch("*** Add File src/a.js", "+content"),
    patch("*** Add File: src/a.js"),
    patch("*** Update File: src/a.js"),
    patch("*** Move to: src/a.js", "+content"),
    "*** Begin Patch\n*** End Patch",
    "prefix\n*** Begin Patch\n*** Add File: src/a.js\n+x\n*** End Patch",
    "*** Begin Patch\n*** Add File: src/a.js\n+x\n*** End Patch\nsuffix",
    "*** Add File: src/a.js\n+x",
  ]) {
    const parsed = parseApplyPatch(command);
    assert.equal(parsed.ok, false, command);
    assert.equal(typeof parsed.reason, "string", command);
    assert.ok(parsed.reason.length > 0, command);
  }
});

test("parseApplyPatch rejects POSIX, Windows, UNC, drive-relative, traversal, and control-character paths", () => {
  const badPaths = [
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "C:/Windows/system.ini",
    "C:Windows/system.ini",
    "\\\\server\\share\\file.js",
    "../outside.js",
    "src/../../outside.js",
    "src\\..\\outside.js",
    ".",
    "./",
    "src/",
    "src/file.js\rsmuggled",
    "src/file.js\0smuggled",
  ];

  for (const path of badPaths) {
    const parsed = parseApplyPatch(patch(`*** Update File: ${path}`, "@@", "-old", "+new"));
    assert.equal(parsed.ok, false, JSON.stringify(path));
  }
});

test("parseApplyPatch rejects duplicate and conflicting directives or move metadata", () => {
  for (const command of [
    patch(
      "*** Update File: src/a.js",
      "@@",
      "-one",
      "+two",
      "*** Update File: src/a.js",
      "@@",
      "-two",
      "+three",
    ),
    patch("*** Add File: src/a.js", "+one", "*** Update File: src/a.js", "@@", "-one", "+two"),
    patch("*** Add File: src/a.js", "+one", "*** Update File: ./src//a.js", "@@", "-one", "+two"),
    patch("*** Add File: src\\a.js", "+one", "*** Update File: src/a.js", "@@", "-one", "+two"),
    patch(
      "*** Update File: src/a.js",
      "*** Move to: src/b.js",
      "*** Move to: src/c.js",
      "@@",
      "-one",
      "+two",
    ),
    patch(
      "*** Update File: src/a.js",
      "*** Move to: src/b.js",
      "@@",
      "-one",
      "+two",
      "*** Add File: src/b.js",
      "+conflict",
    ),
    patch("*** Update File: src/a.js", "@@", "-one", "+two", "*** Move to: src/b.js"),
  ]) {
    assert.equal(parseApplyPatch(command).ok, false, command);
  }
});

test("parseApplyPatch rejects raw unified and binary diff syntax", () => {
  for (const command of [
    patch("*** Update File: src/a.js", "diff --git a/src/a.js b/src/a.js", "@@", "-one", "+two"),
    patch("*** Update File: src/a.js", "--- a/src/a.js", "+++ b/src/a.js", "@@", "-one", "+two"),
    patch("*** Add File: image.bin", "GIT binary patch", "literal 0"),
    patch("*** Add File: image.bin", "Binary files /dev/null and b/image.bin differ"),
  ]) {
    assert.equal(parseApplyPatch(command).ok, false, command);
  }
});

test("evaluatePatch allows Yellow planning patches and denies production patches", () => {
  assert.deepEqual(
    evaluatePatch(patch("*** Add File: docs/plans/new.md", "+plan"), yellow, { cwd }),
    { allow: true },
  );

  const denied = evaluatePatch(
    patch("*** Update File: docs/plans/a.md", "@@", "-a", "+b", "*** Update File: src/a.js", "@@", "-a", "+b"),
    yellow,
    { cwd },
  );
  assert.equal(denied.allow, false);
  assert.match(denied.reason, /Yellow permits planning artifacts only/);
});

test("evaluatePatch checks every moved path under path-bound Green and preserves resetToRed", () => {
  assert.deepEqual(
    evaluatePatch(
      patch("*** Update File: src/old.js", "*** Move to: src/new.js", "@@", "-old", "+new"),
      pathGreen,
      { cwd },
    ),
    { allow: true },
  );

  const denied = evaluatePatch(
    patch("*** Update File: src/old.js", "*** Move to: package.json", "@@", "-old", "+new"),
    pathGreen,
    { cwd },
  );
  assert.equal(denied.allow, false);
  assert.equal(denied.resetToRed, true);
  assert.match(denied.reason, /outside the Green path allowlist/);
});

test("evaluatePatch denies Red, malformed patches, deletions, and missing cwd", () => {
  assert.equal(
    evaluatePatch(patch("*** Update File: src/a.js", "@@", "-a", "+b"), red, { cwd }).allow,
    false,
  );
  assert.equal(evaluatePatch("not a patch", semanticGreen, { cwd }).allow, false);
  assert.equal(evaluatePatch(patch("*** Delete File: src/a.js"), semanticGreen, { cwd }).allow, false);
  assert.equal(
    evaluatePatch(patch("*** Update File: src/a.js", "@@", "-a", "+b"), semanticGreen, {}).allow,
    false,
  );
});
