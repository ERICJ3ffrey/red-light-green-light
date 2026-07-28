import { resolve } from "node:path";
import { buildPlanningRoots, isAllowedPlanningWrite, isAllowedScopedWrite } from "./planning-paths.js";

const FILE_WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const READ_ONLY_TOOLS = new Set([
  "read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content",
  "vault_graph_status", "vault_graph_query", "graphify_status", "graphify_query",
  "questionnaire", "interview", "ask_user", "AskUserQuestion"
]);
const SAFE_SEGMENT = /^(?:cat|head|tail|less|more|grep|rg|find|fd|ls|pwd|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|cal|uptime|ps|jq|bat|eza)\b|^git\s+(?:status|log|diff|show|branch|remote|config\s+--get|ls-)\b|^(?:npm|pnpm|yarn)\s+(?:test|list|ls|view|info|outdated|audit)\b|^(?:node|python|python3)\s+--version\b/i;
const FORBIDDEN_SHELL = /(?:&&|\|\||;|\r|\n|>|<|`|\$\(|\b(?:rm|mv|cp|mkdir|touch|chmod|chown|ln|tee|truncate|dd|shred|sudo|kill|reboot|shutdown)\b)/i;
const PROTECTED = /\bgit\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|update|publish|link|ci)\b|\bpip\s+(?:install|uninstall)\b|\b(?:vercel|netlify)\b.*\bdeploy\b|\bkubectl\s+(?:apply|delete)\b|\bterraform\s+(?:apply|destroy)\b|\bdocker\s+push\b/i;

export function isReadOnlyCommand(command) {
  const text = String(command || "").trim();
  if (!text || FORBIDDEN_SHELL.test(text)) return false;
  return text.split(/\|(?!\|)/).every((segment) => SAFE_SEGMENT.test(segment.trim()));
}

export function isProtectedCommand(command) {
  return PROTECTED.test(String(command || ""));
}

export function evaluateToolCall(event, state, options) {
  const cwd = options.cwd;
  const toolName = event.toolName;
  const input = event.input || {};

  if (READ_ONLY_TOOLS.has(toolName)) return { allow: true };

  if (FILE_WRITE_TOOLS.has(toolName)) {
    if (state.mode === "red") return { allow: false, reason: "Red blocks file writes." };
    const path = input.path;
    if (!path) return { allow: false, reason: "Write tool has no classifiable path." };
    const absolutePath = resolve(cwd, path);
    if (state.mode === "yellow") {
      const roots = buildPlanningRoots(cwd, state.planningPaths || []);
      return isAllowedPlanningWrite(absolutePath, roots)
        ? { allow: true }
        : { allow: false, reason: "Yellow permits planning artifacts only." };
    }
    if (state.scopeEnforcement === "path-bound") {
      return isAllowedScopedWrite(absolutePath, cwd, state.allowedPaths || [])
        ? { allow: true }
        : { allow: false, reason: "Write is outside the Green path allowlist.", resetToRed: true };
    }
    return { allow: true };
  }

  if (toolName === "bash") {
    const command = String(input.command || "");
    if (isProtectedCommand(command)) return { allow: false, reason: "Protected command requires separate approval." };
    if (state.mode === "red" || state.mode === "yellow" || state.scopeEnforcement === "path-bound") {
      return isReadOnlyCommand(command)
        ? { allow: true }
        : { allow: false, reason: `${state.mode} permits read-only shell commands only.` };
    }
    return { allow: true };
  }

  if (toolName === "subagent") {
    return state.mode === "green"
      ? { allow: true, decorateDelegation: true }
      : { allow: false, reason: "Delegation is blocked until scoped Green because child writes cannot be mechanically contained." };
  }

  return { allow: false, reason: `Unclassified tool blocked: ${toolName}` };
}
