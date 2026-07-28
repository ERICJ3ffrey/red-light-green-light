import assert from "node:assert/strict";
import test from "node:test";
import extension from "../.pi/extensions/red-light-green-light.ts";

function fakePi() {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  let activeTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  return {
    api: {
      on(name, handler) {
        const list = handlers.get(name) || [];
        list.push(handler);
        handlers.set(name, list);
      },
      registerCommand(name, command) { commands.set(name, command); },
      appendEntry(type, data) { entries.push({ type, data }); },
      getActiveTools() { return [...activeTools]; },
      setActiveTools(next) { activeTools = [...next]; },
    },
    handlers,
    commands,
    entries,
    get activeTools() { return activeTools; },
  };
}

function context() {
  const statuses = [];
  const notices = [];
  return {
    cwd: "/repo",
    mode: "tui",
    hasUI: true,
    ui: {
      theme: { fg: (_kind, text) => text },
      setStatus: (_id, text) => statuses.push(text),
      notify: (text) => notices.push(text),
    },
    sessionManager: { getEntries: () => [] },
    statuses,
    notices,
  };
}

function first(handlers, name) {
  const list = handlers.get(name) || [];
  assert.equal(list.length, 1, `expected one ${name} handler`);
  return list[0];
}

test("new session starts red and removes direct write tools", async () => {
  const pi = fakePi();
  extension(pi.api);
  await first(pi.handlers, "session_start")({ reason: "startup" }, context());
  assert.equal(pi.entries.at(-1).data.mode, "red");
  assert.equal(pi.activeTools.includes("write"), false);
  assert.equal(pi.activeTools.includes("edit"), false);
});

test("new, resumed, forked, and reloaded sessions reset stale green to red", async () => {
  for (const reason of ["new", "resume", "fork", "reload"]) {
    const pi = fakePi();
    extension(pi.api);
    const ctx = context();
    await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
    await pi.commands.get("light").handler("green implement auth", ctx);
    await first(pi.handlers, "session_start")({ reason }, ctx);
    assert.equal(pi.entries.at(-1).data.mode, "red", reason);
  }
});

test("/light yellow records planning path and restores guarded write tools", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await pi.commands.get("light").handler("yellow docs/plans", ctx);
  assert.equal(pi.entries.at(-1).data.mode, "yellow");
  assert.deepEqual(pi.entries.at(-1).data.planningPaths, ["docs/plans"]);
  assert.equal(pi.activeTools.includes("write"), true);
});

test("/light green requires scope and status does not change authority", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await pi.commands.get("light").handler("green", ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
  await pi.commands.get("light").handler("status", ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
  assert.ok(ctx.notices.some((text) => text.includes("Green requires a scope")));
});

test("pure natural-language transition is handled without an agent turn", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  const result = await first(pi.handlers, "input")({ text: "yellow light docs/plans", source: "interactive" }, ctx);
  assert.deepEqual(result, { action: "handled" });
  assert.equal(pi.entries.at(-1).data.mode, "yellow");
});

test("extension-injected input cannot increase authority", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  const result = await first(pi.handlers, "input")({ text: "green light for everything", source: "extension" }, ctx);
  assert.deepEqual(result, { action: "continue" });
  assert.equal(pi.entries.at(-1).data.mode, "red");
});

test("current authority is injected into the per-turn system prompt", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  const result = await first(pi.handlers, "before_agent_start")({ systemPrompt: "base" }, ctx);
  assert.match(result.systemPrompt, /^base/);
  assert.match(result.systemPrompt, /RED/);
});
