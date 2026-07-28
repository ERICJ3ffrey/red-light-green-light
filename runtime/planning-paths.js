import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const PLAN_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const PLAN_NAME = /(plan|spec|design|review|checklist|handoff|contract|notes?)/i;

function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
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
  ];
}

export function isAllowedPlanningWrite(inputPath, roots) {
  const path = resolve(inputPath);
  if (!PLAN_EXTENSIONS.has(extname(path).toLowerCase())) return false;

  return roots.some((root) => {
    const matches = root.exact ? path === root.path : inside(path, root.path);
    if (!matches) return false;
    if (!root.explicit || !root.exact) return true;
    return PLAN_NAME.test(root.path.split(/[\\/]/).pop() || "");
  });
}

export function isAllowedScopedWrite(inputPath, cwd, allowedPaths = []) {
  const path = resolve(inputPath);
  return allowedPaths.some((value) => {
    const root = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
    return path === root || inside(path, root);
  });
}
