import { realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

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
  return [
    { path: resolve(cwd, "docs"), exact: false, explicit: false },
    { path: resolve(cwd, "Docs"), exact: false, explicit: false },
    { path: resolve(cwd, ".superpowers"), exact: false, explicit: false },
    ...explicit.map((value) => {
      const path = absolute(cwd, value);
      return { path, exact: Boolean(extname(path)), explicit: true };
    }),
  ].map((root) => ({ ...root, path: canonical(root.path) }));
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
    if (!root.explicit || !root.exact) return true;
    return PLAN_NAME.test(root.path.split(/[\\/]/).pop() || "");
  });
}

export function isAllowedScopedWrite(inputPath, cwd, allowedPaths = []) {
  const path = canonical(inputPath);
  if (!path) return false;

  return allowedPaths.some((value) => {
    const lexicalRoot = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
    const root = canonical(lexicalRoot);
    return Boolean(root) && (path === root || inside(path, root));
  });
}
