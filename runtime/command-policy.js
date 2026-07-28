import { resolve } from "node:path";
import { buildPlanningRoots, isAllowedPlanningWrite, isAllowedScopedWrite } from "./planning-paths.js";

const FILE_WRITE_TOOLS = new Set(["write", "edit"]);
const READ_ONLY_TOOLS = new Set([
  "read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content",
  "vault_graph_status", "vault_graph_query", "graphify_status", "graphify_query",
  "questionnaire", "interview", "ask_user", "AskUserQuestion"
]);
const SAFE_EXECUTABLES = new Set([
  "cat", "head", "tail", "grep", "ls", "pwd", "wc",
  "diff", "stat", "du", "df", "which", "whereis", "type", "printenv",
  "uname", "whoami", "id", "cal", "uptime", "ps", "jq", "bat", "eza"
]);
const SHELL_OPERATORS = new Set(["|", "||", "&", "&&", ";", "<", ">", "<<", ">>", "(", ")"]);
const GIT_PROTECTED = new Set([
  "add", "commit", "push", "pull", "merge", "rebase", "reset", "checkout", "stash",
  "cherry-pick", "revert", "tag", "init", "clone"
]);
const GIT_KNOWN = new Set([
  ...GIT_PROTECTED, "status", "log", "diff", "show", "branch", "remote", "config", "grep",
  "help", "version", "describe", "rev-parse", "rev-list", "show-ref", "for-each-ref", "ls-files",
  "ls-tree", "ls-remote", "cat-file", "name-rev", "shortlog", "blame", "bisect", "worktree",
  "switch", "restore", "fetch", "gc", "clean", "reflog", "notes", "submodule", "archive", "bundle"
]);
const PACKAGE_PROTECTED = new Set([
  "install", "add", "remove", "uninstall", "update", "upgrade", "publish", "link", "unlink", "ci",
  "test", "run", "run-script", "start", "stop", "restart", "exec", "dlx"
]);
const PACKAGE_KNOWN = new Set([
  ...PACKAGE_PROTECTED, "list", "ls", "view", "info", "outdated", "audit", "help", "version",
  "pack", "whoami", "config"
]);
const UNCONDITIONAL_WRAPPERS = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "csh", "tcsh",
  "cmd", "powershell", "pwsh", "eval", "exec", "xargs", "find", "sudo", "env",
  "busybox", "toybox", "time", "nice", "timeout", "setsid", "bunx", "pnpx",
  "if", "then", "fi", "case", "esac", "for", "while", "until", "do", "done", "function", "select", "coproc"
]);

function executableName(value) {
  const basename = String(value || "").replaceAll("\\", "/").split("/").pop().toLowerCase();
  return basename.replace(/\.(?:exe|cmd|bat)$/i, "");
}

function tokenizeShell(command) {
  const text = String(command ?? "");
  const tokens = [];
  let word = "";
  let wordStarted = false;
  let quote = null;

  const emitWord = () => {
    if (wordStarted) tokens.push({ type: "word", value: word });
    word = "";
    wordStarted = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"') {
        index += 1;
        if (index >= text.length || text[index] === "\r" || text[index] === "\n") return null;
        word += text[index];
      } else if (char === "`" || (char === "$" && quote === '"')) {
        return null;
      } else {
        word += char;
      }
      wordStarted = true;
      continue;
    }

    if (char === "$" || "!{}?*[]".includes(char)) return null;
    if (char === "'" || char === '"') {
      quote = char;
      wordStarted = true;
      continue;
    }
    if (char === "\\") {
      index += 1;
      if (index >= text.length || text[index] === "\r" || text[index] === "\n") return null;
      word += text[index];
      wordStarted = true;
      continue;
    }
    if (char === "`" || (char === "$" && ["(", "{"].includes(text[index + 1]))) return null;
    if (char === "\r" || char === "\n") {
      emitWord();
      tokens.push({ type: "operator", value: ";" });
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      emitWord();
      continue;
    }
    if ("|&;<>()".includes(char)) {
      emitWord();
      const pair = char + (text[index + 1] || "");
      const operator = SHELL_OPERATORS.has(pair) ? pair : char;
      if (operator.length === 2) index += 1;
      tokens.push({ type: "operator", value: operator });
      continue;
    }
    word += char;
    wordStarted = true;
  }

  if (quote) return null;
  emitWord();
  return tokens;
}

function commandSegments(tokens) {
  const segments = [];
  let words = [];
  for (const token of tokens) {
    if (token.type === "operator") {
      if (words.length) segments.push(words);
      words = [];
    } else {
      words.push(token.value);
    }
  }
  if (words.length) segments.push(words);
  return segments;
}

function consumeGlobalOptions(args, family) {
  let index = 0;
  const noValue = family === "git"
    ? new Set(["--paginate", "--no-pager", "--bare", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks"])
    : new Set(["--silent", "--json", "--global", "-g"]);
  const withValue = family === "git"
    ? new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--exec-path"])
    : new Set(["--prefix", "--workspace", "-w", "--userconfig", "--registry", "--cache"]);

  while (index < args.length && args[index].startsWith("-")) {
    const option = args[index];
    if (option === "--") return { index: index + 1, ok: true };
    if (noValue.has(option)) {
      index += 1;
      continue;
    }
    const name = option.split("=", 1)[0];
    if (withValue.has(name)) {
      if (option.includes("=")) {
        if (!option.slice(option.indexOf("=") + 1)) return { ok: false };
        index += 1;
      } else {
        if (index + 1 >= args.length) return { ok: false };
        index += 2;
      }
      continue;
    }
    if (family === "git" && (/^-C.+/.test(option) || /^-c.+/.test(option))) {
      index += 1;
      continue;
    }
    return { ok: false };
  }
  return { index, ok: true };
}

function gitInvocation(words) {
  const consumed = consumeGlobalOptions(words.slice(1), "git");
  if (!consumed.ok) return { known: false, protected: true };
  const subcommand = words[1 + consumed.index]?.toLowerCase();
  if (!subcommand || !GIT_KNOWN.has(subcommand)) return { known: false, protected: true };
  return {
    known: true,
    protected: GIT_PROTECTED.has(subcommand),
    subcommand,
    globalArgs: words.slice(1, 1 + consumed.index),
    args: words.slice(2 + consumed.index),
  };
}

function packageInvocation(words) {
  const consumed = consumeGlobalOptions(words.slice(1), "package");
  if (!consumed.ok) return { known: false, protected: true };
  const subcommand = words[1 + consumed.index]?.toLowerCase();
  if (!subcommand || !PACKAGE_KNOWN.has(subcommand)) return { known: false, protected: true };
  return { known: true, protected: PACKAGE_PROTECTED.has(subcommand), subcommand, args: words.slice(2 + consumed.index) };
}

function classifyProtectedSegment(words, depth = 0) {
  if (depth > 4 || !words.length) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\+)?=/.test(words[0])) return true;

  const executable = executableName(words[0]);
  const actionTokens = words.slice(1).map((word) => word.toLowerCase());
  if (UNCONDITIONAL_WRAPPERS.has(executable) || executable === "npx") return true;
  if (executable.startsWith("git-") || executable === "docker-compose") return true;
  if (executable === "git") return !safeGit(words);
  if (executable === "npm" || executable === "pnpm" || executable === "yarn") return !safePackage(words);
  if (/^pip(?:\d+(?:\.\d+)*)?$/.test(executable)) return true;
  if (executable === "node") {
    return actionTokens.some((word) => ["-e", "--eval", "-p", "--print", "-r", "--require", "--import", "--run", "--loader", "--experimental-loader", "--test-reporter", "--test-reporter-destination"].includes(word)
      || /^-(?:e|p|r).+/.test(word)
      || /^(?:--eval|--print|--require|--import|--run|--loader|--experimental-loader|--test-reporter|--test-reporter-destination)=/.test(word));
  }
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(executable) || executable === "py") {
    return actionTokens.some((word) => /^-[^-]*[cm]/.test(word));
  }
  if (["vercel", "netlify", "kubectl", "terraform", "docker"].includes(executable)) return true;

  if (executable === "env") {
    let index = 1;
    while (index < words.length) {
      const word = words[index];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        index += 1;
      } else if (["-u", "--unset", "-C", "--chdir", "-S", "--split-string"].includes(word)) {
        index += 2;
      } else if (word.startsWith("-")) {
        if (!["-i", "--ignore-environment", "-0", "--null"].includes(word) && !word.includes("=")) return true;
        index += 1;
      } else {
        break;
      }
    }
    return classifyProtectedSegment(words.slice(index), depth + 1);
  }
  if (executable === "command" || executable === "nohup") {
    let index = 1;
    while (words[index]?.startsWith("-")) index += 1;
    return classifyProtectedSegment(words.slice(index), depth + 1);
  }
  return false;
}

function safeGit(words) {
  const invocation = gitInvocation(words);
  if (!invocation.known || invocation.protected) return false;
  for (let index = 0; index < invocation.globalArgs.length; index += 1) {
    const option = invocation.globalArgs[index];
    if (["--no-pager", "--paginate", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks"].includes(option)) continue;
    if (option === "-C") {
      index += 1;
      if (index >= invocation.globalArgs.length) return false;
      continue;
    }
    if (/^-C.+/.test(option)) continue;
    return false;
  }
  const args = invocation.args;
  if (["status", "log", "diff", "show"].includes(invocation.subcommand)) {
    return !args.some((arg) => arg === "--ext-diff" || arg === "--textconv" || arg === "--output" || arg.startsWith("--output="));
  }
  if (invocation.subcommand === "branch") {
    const mutating = new Set(["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--edit-description", "--set-upstream-to", "--unset-upstream"]);
    return args.includes("--list") && !args.some((arg) => mutating.has(arg) || arg.startsWith("--set-upstream-to="));
  }
  if (invocation.subcommand === "remote") {
    return (args.length === 1 && ["-v", "--verbose"].includes(args[0]))
      || (args.length === 2 && args[0] === "get-url" && !args[1].startsWith("-"));
  }
  if (invocation.subcommand === "config") return args.length >= 2 && args[0] === "--get";
  return invocation.subcommand.startsWith("ls-");
}

function safePackage(words) {
  const invocation = packageInvocation(words);
  if (!invocation.known || invocation.protected) return false;
  if (!["list", "ls", "view", "info", "outdated", "audit"].includes(invocation.subcommand)) return false;
  return invocation.subcommand !== "audit" || !invocation.args.some((arg) => {
    const value = arg.toLowerCase();
    return value === "fix" || value === "--fix" || value.startsWith("--fix=");
  });
}

function safeSegment(words) {
  const executable = executableName(words[0]);
  if (executable === "rg") return !words.slice(1).some((arg) => arg === "--pre" || arg.startsWith("--pre="));
  if (SAFE_EXECUTABLES.has(executable)) return true;
  if (executable === "git") return safeGit(words);
  if (executable === "npm" || executable === "pnpm" || executable === "yarn") return safePackage(words);
  if (["node", "python", "python3"].includes(executable)) return words.length === 2 && words[1] === "--version";
  return false;
}

function validState(state) {
  if (!state || typeof state !== "object") return false;
  if (state.mode === "red") return true;
  if (state.mode === "yellow") {
    return Array.isArray(state.planningPaths)
      && state.planningPaths.every((path) => typeof path === "string" && Boolean(path.trim()));
  }
  if (state.mode !== "green" || typeof state.scope !== "string" || !state.scope.trim()) return false;
  if (state.scopeEnforcement === "semantic") return true;
  return state.scopeEnforcement === "path-bound"
    && Array.isArray(state.allowedPaths)
    && state.allowedPaths.length > 0
    && state.allowedPaths.every((path) => typeof path === "string" && Boolean(path.trim()));
}

export function isReadOnlyCommand(command) {
  const tokens = tokenizeShell(command);
  if (!tokens?.length) return false;
  if (tokens.some((token) => token.type === "operator" && token.value !== "|")) return false;
  if (tokens[0].type === "operator" || tokens.at(-1).type === "operator") return false;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index].type === "operator" && tokens[index - 1].type === "operator") return false;
  }
  return commandSegments(tokens).every(safeSegment);
}

export function isProtectedCommand(command) {
  const tokens = tokenizeShell(command);
  if (!tokens?.length) return true;
  return commandSegments(tokens).some(classifyProtectedSegment);
}

export function evaluateToolCall(event, state, options) {
  const cwd = options.cwd;
  const toolName = event.toolName;
  const input = event.input || {};

  if (READ_ONLY_TOOLS.has(toolName)) return { allow: true };
  if (!validState(state)) return { allow: false, reason: "Invalid authority state; Red restrictions apply." };

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
    if (isProtectedCommand(command)) return { allow: false, reason: "Protected command is blocked by the Stage 1 adapter; use a separate user-controlled channel." };
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
