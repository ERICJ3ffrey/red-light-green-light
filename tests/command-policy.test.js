import assert from "node:assert/strict";
import test from "node:test";
import { evaluateToolCall, isReadOnlyCommand, isProtectedCommand } from "../runtime/command-policy.js";

const cwd = "/repo";

const red = { mode: "red" };
const yellow = { mode: "yellow", planningPaths: ["docs/plans"] };
const semanticGreen = { mode: "green", scope: "auth", scopeEnforcement: "semantic" };
const pathGreen = { mode: "green", scope: "auth", scopeEnforcement: "path-bound", allowedPaths: ["src/auth.js"] };

test("read-only shell permits inspection commands and pipelines", () => {
  for (const command of [
    "rg -n auth src | head -20",
    "git status --short",
    "git branch --list",
    "git remote -v",
    "git remote get-url origin",
    "npm audit",
  ]) assert.equal(isReadOnlyCommand(command), true, command);
});

test("read-only shell rejects exact restricted-shell bypasses", () => {
  for (const command of [
    "find . -delete",
    "sort -o victim input",
    "diff --output=victim.txt before after",
    "diff -o victim.txt before after",
    "uniq input output",
    "less -o logfile input",
    "more input",
    "env node -e \"...\"",
    "git branch -D main",
    "git remote set-url origin x",
    "npm audit fix",
    "npm audit --fix=true",
    "pnpm audit --fix=true",
    "npm test",
    "ls & node scripts/fix.js",
    "rg --pre 'touch /tmp/pwn' needle .",
    "rg --pre=cat needle .",
    "tree -o victim.txt .",
    "file -C -m custom.magic",
    "date --set tomorrow",
  ]) assert.equal(isReadOnlyCommand(command), false, command);
});

test("read-only shell rejects mutation, redirection, substitution, and malformed quotes", () => {
  for (const command of [
    "rg auth src > result.txt",
    "ls && rm -rf build",
    "node scripts/fix.js",
    "echo $(touch victim)",
    "echo `touch victim`",
    "rg 'unclosed",
    "git -c core.pager=evil status",
  ]) assert.equal(isReadOnlyCommand(command), false, command);
});

test("protected classification catches option and Windows executable bypasses", () => {
  for (const command of [
    "git -C . commit -m done",
    "git --no-pager push",
    "npm --prefix . install lodash",
    "git.exe commit -m done",
  ]) assert.equal(isProtectedCommand(command), true, command);
});

test("protected classification preserves known gate categories and denies wrappers", () => {
  for (const command of [
    "git commit -am done",
    "git push origin main",
    "pnpm add lodash",
    "pip install thing",
    "vercel deploy --prod",
    "kubectl delete pod app",
    "terraform destroy",
    "docker push image",
    "env git commit -m done",
    "bash -c 'git push origin main'",
    "bash script-that-might-commit.sh",
    "powershell.exe -NoProfile -NonInteractive -Command git push origin main",
    "pwsh -ExecutionPolicy Bypass -Command npm install x",
    "bash -c 'echo hello'",
    "sh -c 'echo hello'",
    "cmd /c echo hello",
    "powershell -Command 'Write-Output hello'",
    "eval echo hello",
    "exec echo hello",
    "xargs echo hello",
    "find . -print",
    "sudo git status",
  ]) {
    assert.equal(isProtectedCommand(command), true, command);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, false, command);
  }
});

test("protected classification denies dynamic dispatch and repository-defined package commands", () => {
  for (const command of [
    "bash -c 'exec git commit -m done'",
    "bash -c 'if true; then git commit -m done; fi'",
    "powershell -Command \"Invoke-Expression 'git commit -m done'\"",
    "powershell -Command \"Start-Process git -ArgumentList commit\"",
    "FOO=bar git commit -m done",
    "$'git' commit -m done",
    "npm exec -- git commit -m done",
    "npx git commit -m done",
    "npm test",
    "npm run check",
    "npm run-script check",
    "npm start",
    "npm stop",
    "npm restart",
    "npm exec echo",
    "pnpm dlx tool",
  ]) {
    assert.equal(isProtectedCommand(command), true, command);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, false, command);
  }
});

test("protected classification blocks practical dynamic-dispatch bypasses under semantic Green", () => {
  for (const command of [
    "FOO+=bar git commit -m done",
    "${UNSET:-git} commit -m done",
    "ash -c 'git commit -m done'",
    "fish -c 'git push'",
    "busybox sh -c 'git push'",
    "toybox sh -c 'git push'",
    "node -e \"require('node:child_process').execFileSync('git',['commit','-m','x'])\"",
    "node --eval \"process.exit()\"",
    "node -p \"process.version\"",
    "node --print \"process.version\"",
    "node -r ./hook.js script.js",
    "node --require=./hook.js script.js",
    "node --import ./hook.mjs script.js",
    "python -c \"__import__('subprocess').run(['git','commit','-m','x'])\"",
    "python -m pip install x",
    "python3 -c \"__import__('os').system('git push')\"",
    "python3 -m pip install x",
    "python -Ic \"print('dynamic')\"",
    "python -qc \"print('dynamic')\"",
    "python -Bc \"print('dynamic')\"",
    "\"$SHELL\" -c 'git commit -m x'",
    "$GIT commit -m x",
    "time git commit -m x",
    "nice git commit -m x",
    "timeout 5 git push",
    "setsid git commit -m x",
    "node --run=test",
    "node --experimental-loader=./hook.mjs script.js",
    "bunx package",
    "pnpx package",
    "g\\\nit commit -m x",
    "env NODE_OPTIONS=--require=./hook.js node script.js",
    "node --test-reporter=./hook.mjs --test",
    "! git commit -m x",
    "{ git commit -m x; }",
    "if git commit -m x; then :; fi",
    "{git,commit,-m,x}",
    "/usr/bin/g?t commit -m x",
  ]) {
    assert.equal(isProtectedCommand(command), true, command);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, false, command);
  }
});

test("semantic Green retains the documented direct-script transitive-behavior residual", () => {
  for (const command of [
    "node script.js",
    "python script.py",
    "python3 script.py",
    "unknown-benign-command",
  ]) {
    assert.equal(isProtectedCommand(command), false, command);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, true, command);
  }
});

test("protected classification finds family actions after global options", () => {
  for (const command of [
    "pip --proxy http://localhost install thing",
    "kubectl --namespace default delete pod app",
    "terraform -chdir=. destroy",
    "docker --context default push image",
    "git clean -fdx",
    "git remote set-url origin x",
    "git config user.email x@example.com",
    "npm config set registry https://example.com",
    "pip config set global.index-url https://example.com",
    "kubectl create namespace x",
    "terraform state rm resource.x",
    "docker rm container",
    "git-commit -m x",
    "pip3.12 install thing",
    "python3.12 -m pip install thing",
    "py -m pip install thing",
    "docker-compose up",
  ]) {
    assert.equal(isProtectedCommand(command), true, command);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, false, command);
  }
  for (const command of ["git status --short", "git config --get user.email", "npm view lodash version"]) {
    assert.equal(isProtectedCommand(command), false, command);
  }
});

test("protected classification fails closed on malformed or unknown family syntax", () => {
  assert.equal(isProtectedCommand("git 'unclosed"), true);
  assert.equal(isProtectedCommand("git --mystery-option commit -m done"), true);
  assert.equal(isProtectedCommand("git mystery-subcommand"), true);
});

test("semantic Green permits benign single commands outside the restricted allowlist", () => {
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "echo hello" } }, semanticGreen, { cwd }).allow, true);
});

test("protected commands stay blocked under semantic Green", () => {
  for (const command of [
    "git -C . commit -m done",
    "git --no-pager push",
    "npm --prefix . install lodash",
    "git.exe commit -m done",
    "bash -c 'exec git commit -m done'",
    "bash -c 'if true; then git commit -m done; fi'",
    "powershell -Command \"Invoke-Expression 'git commit -m done'\"",
    "powershell -Command \"Start-Process git -ArgumentList commit\"",
    "FOO=bar git commit -m done",
    "$'git' commit -m done",
    "npm exec -- git commit -m done",
    "npx git commit -m done",
  ]) assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, semanticGreen, { cwd }).allow, false, command);
});

test("invalid state denies every non-read-only tool as Red-equivalent", () => {
  const invalidStates = [
    {},
    { mode: "bogus" },
    { mode: "yellow" },
    { mode: "yellow", planningPaths: "docs" },
    { mode: "yellow", planningPaths: [1] },
    { mode: "green", scopeEnforcement: "semantic" },
    { mode: "green", scope: "   ", scopeEnforcement: "semantic" },
    { mode: "green", scope: "auth" },
    { mode: "green", scope: "auth", scopeEnforcement: "other" },
    { mode: "green", scope: "auth", scopeEnforcement: "path-bound" },
    { mode: "green", scope: "auth", scopeEnforcement: "path-bound", allowedPaths: [] },
    { mode: "green", scope: "auth", scopeEnforcement: "path-bound", allowedPaths: [""] },
    { mode: "green", scope: "auth", scopeEnforcement: "path-bound", allowedPaths: ["src", 1] },
  ];

  for (const state of invalidStates) {
    assert.equal(evaluateToolCall({ toolName: "write", input: { path: "/repo/src/auth.js" } }, state, { cwd }).allow, false);
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "echo change" } }, state, { cwd }).allow, false);
    assert.equal(evaluateToolCall({ toolName: "subagent", input: {} }, state, { cwd }).allow, false);
  }
});

test("read-only tools remain available when state is invalid", () => {
  assert.equal(evaluateToolCall({ toolName: "read", input: { path: "/repo/a" } }, {}, { cwd }).allow, true);
});

test("valid Red, Yellow, and Green behavior stays intact", () => {
  assert.equal(evaluateToolCall({ toolName: "write", input: { path: "/repo/src/auth.js" } }, red, { cwd }).allow, false);
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "git status --short" } }, red, { cwd }).allow, true);

  assert.equal(evaluateToolCall({ toolName: "write", input: { path: "/repo/docs/plans/auth.md" } }, yellow, { cwd }).allow, true);
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/src/auth.js" } }, yellow, { cwd }).allow, false);

  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/src/auth.js" } }, pathGreen, { cwd }).allow, true);
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "/repo/package.json" } }, pathGreen, { cwd }).allow, false);
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "node scripts/rewrite.js" } }, pathGreen, { cwd }).allow, false);
  assert.equal(evaluateToolCall({ toolName: "subagent", input: {} }, semanticGreen, { cwd }).allow, true);
});

test("apply_patch is unclassified and denied for both Green modes", () => {
  const event = { toolName: "apply_patch", input: { path: "/repo/src/auth.js" } };
  assert.equal(evaluateToolCall(event, semanticGreen, { cwd }).allow, false);
  assert.equal(evaluateToolCall(event, pathGreen, { cwd }).allow, false);
});

test("unknown custom tools fail closed", () => {
  assert.equal(evaluateToolCall({ toolName: "mystery_mutator", input: {} }, semanticGreen, { cwd }).allow, false);
});
