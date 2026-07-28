import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const PLAN_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const PLAN_NAME = /(plan|spec|design|review|checklist|handoff|contract|notes?)/i;

function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function canonical(path) {
  let candidate = resolve(path);
  const remainder = [];

  while (true) {
    try {
      const existing = realpathSync.native(candidate);
      return resolve(existing, ...remainder.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") return null;
      try {
        if (lstatSync(candidate).isSymbolicLink()) return null;
      } catch (statError) {
        if (statError?.code !== "ENOENT" && statError?.code !== "ENOTDIR") return null;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      remainder.push(candidate.slice(parent.length).replace(/^[\\/]+/, ""));
      candidate = parent;
    }
  }
}

function absolute(cwd, path) {
  return resolve(cwd, path);
}

export function buildPlanningRoots(cwd, explicit = []) {
  const canonicalCwd = canonical(cwd);
  return [
    { path: resolve(cwd, "docs"), exact: false, explicit: false, absoluteExplicit: false },
    { path: resolve(cwd, "Docs"), exact: false, explicit: false, absoluteExplicit: false },
    { path: resolve(cwd, ".superpowers"), exact: false, explicit: false, absoluteExplicit: false },
    ...explicit.map((value) => {
      const path = absolute(cwd, value);
      return { path, exact: Boolean(extname(path)), explicit: true, absoluteExplicit: isAbsolute(value) };
    }),
  ].map((root) => {
    const path = canonical(root.path);
    // Authorization reflects filesystem state at evaluation time; Task 8 documents the external TOCTOU residual.
    const escapedRelativeRoot = !root.absoluteExplicit
      && (!canonicalCwd || !path || !inside(path, canonicalCwd));
    const overlyBroadRoot = root.explicit && !root.exact && canonicalCwd && path === canonicalCwd;
    return { ...root, path: escapedRelativeRoot || overlyBroadRoot ? null : path };
  });
}

export function isAllowedPlanningWrite(inputPath, roots) {
  const lexicalPath = resolve(inputPath);
  if (!PLAN_EXTENSIONS.has(extname(lexicalPath).toLowerCase())) return false;
  const path = canonical(lexicalPath);
  if (!path) return false;

  return roots.some((root) => {
    if (!root.path) return false;
    const canonicalRoot = canonical(root.path);
    if (!canonicalRoot) return false;
    const matches = root.exact ? path === canonicalRoot : inside(path, canonicalRoot);
    if (!matches) return false;
    const planningSignal = [basename(canonicalRoot), relative(canonicalRoot, path)]
      .filter(Boolean)
      .join("/");
    return PLAN_NAME.test(planningSignal);
  });
}

export function isAllowedScopedWrite(inputPath, cwd, allowedPaths = []) {
  const path = canonical(inputPath);
  const canonicalCwd = canonical(cwd);
  if (!path || !canonicalCwd) return false;

  return allowedPaths.some((value) => {
    const absoluteRoot = isAbsolute(value);
    const lexicalRoot = absoluteRoot ? resolve(value) : resolve(cwd, value);
    const root = canonical(lexicalRoot);
    // Authorization reflects filesystem state at evaluation time; Task 8 documents the external TOCTOU residual.
    if (!root || (!absoluteRoot && !inside(root, canonicalCwd))) return false;
    return path === root || inside(path, root);
  });
}
