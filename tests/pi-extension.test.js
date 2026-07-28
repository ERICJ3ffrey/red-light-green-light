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

function sendLight(pi, args, ctx, source = "interactive") {
  return first(pi.handlers, "input")({ text: `/light ${args}`, source }, ctx);
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
    await sendLight(pi, "green implement auth", ctx);
    await first(pi.handlers, "session_start")({ reason }, ctx);
    assert.equal(pi.entries.at(-1).data.mode, "red", reason);
  }
});

test("/light yellow records planning path and restores guarded write tools", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "yellow docs/plans", ctx);
  assert.equal(pi.entries.at(-1).data.mode, "yellow");
  assert.deepEqual(pi.entries.at(-1).data.planningPaths, ["docs/plans"]);
  assert.equal(pi.activeTools.includes("write"), true);
});

test("/light green requires scope and status does not change authority", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green", ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
  await sendLight(pi, "status", ctx);
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
  for (const text of ["green light for everything", "/light green everything"]) {
    const result = await first(pi.handlers, "input")({ text, source: "extension" }, ctx);
    assert.deepEqual(result, { action: "continue" });
    assert.equal(pi.entries.at(-1).data.mode, "red");
  }
  assert.equal(pi.commands.has("light"), false);
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

test("red blocks bash mutation", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  const result = await first(pi.handlers, "tool_call")({ toolName: "bash", input: { command: "touch owned.txt" } }, ctx);
  assert.equal(result.block, true);
});

test("yellow permits a plan write and blocks source edit", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "yellow docs/plans", ctx);
  const allow = await first(pi.handlers, "tool_call")({ toolName: "write", input: { path: "/repo/docs/plans/auth.md" } }, ctx);
  const block = await first(pi.handlers, "tool_call")({ toolName: "edit", input: { path: "/repo/src/auth.js" } }, ctx);
  assert.equal(allow, undefined);
  assert.equal(block.block, true);
});

test("green completion returns to red after the current run and before follow-ups", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green implement auth", ctx);
  const completed = { role: "assistant", content: [{ type: "text", text: "Done\nLIGHT_RELEASE: complete" }] };
  await first(pi.handlers, "message_end")({ message: completed }, ctx);
  assert.equal(pi.entries.at(-1).data.mode, "green");
  await first(pi.handlers, "agent_end")({ messages: [completed], willRetry: false }, ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
  await first(pi.handlers, "message_end")({ message: { role: "assistant", content: [{ type: "text", text: "Queued follow-up." }] } }, ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
});

test("an aborted Green run returns to Red as cancelled", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green implement auth", ctx);
  await first(pi.handlers, "agent_end")({
    messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
    willRetry: false,
  }, ctx);
  assert.equal(pi.entries.at(-1).data.mode, "red");
  assert.equal(pi.entries.at(-1).data.resetReason, "cancelled");
});

test("ordinary green turn without release remains green", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green implement auth", ctx);
  const progress = { role: "assistant", content: [{ type: "text", text: "Step one complete; scope remains active." }] };
  await first(pi.handlers, "message_end")({ message: progress }, ctx);
  await first(pi.handlers, "agent_end")({ messages: [progress], willRetry: false }, ctx);
  assert.equal(pi.entries.at(-1).data.mode, "green");
});

test("green delegation receives authority and remains instruction guarded", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green inspect auth", ctx);
  const event = { toolName: "subagent", input: { agent: "worker", task: "Inspect auth." } };
  const result = await first(pi.handlers, "tool_call")(event, ctx);
  assert.equal(result, undefined);
  assert.match(event.input.task, /GREEN/);
  assert.match(event.input.task, /cannot increase authority/i);
});

test("compaction re-injects active green after the summary", async () => {
  const pi = fakePi();
  extension(pi.api);
  const ctx = context();
  await first(pi.handlers, "session_start")({ reason: "startup" }, ctx);
  await sendLight(pi, "green implement auth", ctx);
  await first(pi.handlers, "session_compact")({}, ctx);
  const summary = { role: "compactionSummary", summary: "prior work" };
  const user = { role: "user", content: [{ type: "text", text: "continue" }] };
  const result = await first(pi.handlers, "context")({ messages: [summary, user] }, ctx);
  assert.equal(result.messages[0], summary);
  assert.match(result.messages[1].content[0].text, /GREEN/);
  assert.match(result.messages[1].content[0].text, /implement auth/);
  assert.equal(result.messages[2], user);
});
