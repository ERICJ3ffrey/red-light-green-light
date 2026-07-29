import { isAbsolute, posix, win32 } from "node:path";

import { evaluateToolCall } from "./command-policy.js";

function denied(reason) {
  return { ok: false, reason };
}

function parsePath(raw) {
  if (typeof raw !== "string" || !raw || raw !== raw.trim()) {
    return denied("Patch path must be a non-empty path without surrounding whitespace.");
  }
  if (/[\0\r\n]/.test(raw)) return denied("Patch path contains a control character.");
  if (isAbsolute(raw) || posix.isAbsolute(raw) || win32.isAbsolute(raw) || raw.includes(":")) {
    return denied("Patch paths must be relative.");
  }
  if (raw.split(/[\\/]+/).includes("..")) return denied("Patch path traversal is not allowed.");
  const portable = raw.replaceAll("\\", "/");
  if (portable.endsWith("/") || posix.normalize(portable) === ".") {
    return denied("Patch path must identify a file.");
  }
  return { ok: true, path: raw };
}

function conflictKey(path) {
  return posix.normalize(path.replaceAll("\\", "/")).toLowerCase();
}

function isRawDiffLine(line) {
  return /^(?:diff --git |index [0-9a-f]+\.\.|--- |\+\+\+ |GIT binary patch$|Binary files .+ differ$)/i.test(line);
}

export function parseApplyPatch(command) {
  if (typeof command !== "string" || !command) return denied("Patch command must be a non-empty string.");
  if (command.includes("\0")) return denied("Patch command contains a NUL byte.");

  let text = command.replaceAll("\r\n", "\n");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  if (text.includes("\r")) return denied("Patch command contains a bare carriage return.");

  const lines = text.split("\n");
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    return denied("Patch must use an exact Begin Patch and End Patch envelope.");
  }

  const operations = [];
  const targets = new Set();
  let current;

  const register = (kind, path) => {
    const key = conflictKey(path);
    if (targets.has(key)) return denied(`Conflicting patch directives target: ${path}`);
    targets.add(key);
    operations.push({ kind, path });
    return { ok: true };
  };

  const finishCurrent = () => {
    if (current && !current.hasContent) return denied(`Patch directive has no patch content: ${current.path}`);
    return { ok: true };
  };

  for (const line of lines.slice(1, -1)) {
    const fileMatch = line.match(/^\*\*\* (Add|Update) File: (.*)$/);
    if (fileMatch) {
      const finished = finishCurrent();
      if (!finished.ok) return finished;

      const parsedPath = parsePath(fileMatch[2]);
      if (!parsedPath.ok) return parsedPath;
      const kind = fileMatch[1].toLowerCase();
      const registered = register(kind, parsedPath.path);
      if (!registered.ok) return registered;
      current = { kind, path: parsedPath.path, hasContent: false, moved: false };
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.*)$/);
    if (moveMatch) {
      if (!current || current.kind !== "update") return denied("Move to requires an Update File directive.");
      if (current.moved) return denied("Update File contains duplicate Move to metadata.");
      if (current.hasContent) return denied("Move to must appear before patch content.");

      const parsedPath = parsePath(moveMatch[1]);
      if (!parsedPath.ok) return parsedPath;
      const registered = register("update", parsedPath.path);
      if (!registered.ok) return registered;
      current.moved = true;
      continue;
    }

    if (/^\*\*\* Delete File:/.test(line)) return denied("Delete File is not allowed.");
    if (line.startsWith("***")) {
      if (line === "*** End of File" && current) {
        current.hasContent = true;
        continue;
      }
      return denied(`Unsupported or malformed patch directive: ${line}`);
    }
    if (!current) return denied("Patch content appears before a file directive.");
    if (isRawDiffLine(line)) return denied("Raw unified or binary diff syntax is not allowed.");
    if (line.length > 0) current.hasContent = true;
  }

  const finished = finishCurrent();
  if (!finished.ok) return finished;
  if (!operations.length) return denied("Patch contains no file operations.");
  return { ok: true, operations };
}

export function evaluatePatch(command, state, options = {}) {
  if (typeof options.cwd !== "string" || !options.cwd.trim()) {
    return { allow: false, reason: "Patch evaluation requires a working directory." };
  }

  const parsed = parseApplyPatch(command);
  if (!parsed.ok) return { allow: false, reason: parsed.reason };

  try {
    for (const operation of parsed.operations) {
      const decision = evaluateToolCall(
        {
          toolName: operation.kind === "add" ? "write" : "edit",
          input: { path: operation.path },
        },
        state,
        { cwd: options.cwd },
      );
      if (!decision.allow) return decision;
    }
  } catch {
    return { allow: false, reason: "Patch path evaluation failed." };
  }

  return { allow: true };
}
