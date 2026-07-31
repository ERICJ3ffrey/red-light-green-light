import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  applyUserTransition,
  createRedState,
  detectRelease,
  parseLightArgs,
  parseTransitionMessage,
  renderAuthorityContext,
} from "../../runtime/protocol.js";
import { evaluateToolCall } from "../../runtime/command-policy.js";

const WRITE_TOOLS = new Set(["edit", "write"]);
const STATE_ENTRY = "red-light-green-light-state";
const STATE_RUNTIME_ID = "__redLightGreenLightRuntimeId";
const runtimeGlobal = globalThis as typeof globalThis & { __redLightGreenLightRuntimeId?: string };
const RUNTIME_ID = runtimeGlobal.__redLightGreenLightRuntimeId ||= `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

type LightState = ReturnType<typeof createRedState> & {
  planningPaths?: string[];
  scope?: string;
  scopeEnforcement?: "path-bound" | "semantic";
  allowedPaths?: string[];
  releasePolicy?: "manual";
  grantedByUserEntry?: string;
};

function messageText(message: unknown): string {
  const value = message as { role?: string; content?: unknown };
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .filter((part): part is { type: string; text: string } => Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text"))
    .map((part) => part.text)
    .join("\n");
}

function decorateDelegation(input: Record<string, unknown>, state: LightState): void {
  const prefix = `${renderAuthorityContext(state)}\n\nDelegated work cannot increase authority.\n\n`;
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.task === "string") record.task = prefix + record.task;
    for (const key of ["tasks", "chain", "parallel"]) visit(record[key]);
  }
  visit(input);
}

function stateFromEntry(entry: unknown): LightState | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const customType = record.customType || record.type;
  if (customType !== STATE_ENTRY) return undefined;
  const data = record.data;
  if (!data || typeof data !== "object") return undefined;
  const mode = (data as { mode?: unknown }).mode;
  return mode === "red" || mode === "yellow" || mode === "green" ? data as LightState : undefined;
}

function sessionStates(ctx?: ExtensionContext): LightState[] {
  const entries = ctx?.sessionManager?.getEntries?.() || [];
  return entries.map(stateFromEntry).filter((entry): entry is LightState => Boolean(entry));
}

export default function redLightGreenLight(pi: ExtensionAPI): void {
  let state: LightState = createRedState("startup") as LightState;
  let toolsBeforeRed: string[] | undefined;
  let pendingRelease: string | undefined;
  let reinjectAfterCompaction = false;

  function persist(next: LightState, ctx?: ExtensionContext): void {
    state = { ...next, [STATE_RUNTIME_ID]: RUNTIME_ID } as LightState;
    pi.appendEntry(STATE_ENTRY, state);
    setStatus(ctx);
  }

  function setStatus(ctx?: ExtensionContext): void {
    const label = state.mode === "green" ? `GREEN: ${state.scope}` : state.mode.toUpperCase();
    ctx?.ui?.setStatus("red-light-green-light", label);
  }

  function restoreLatestSessionState(ctx?: ExtensionContext, sameRuntimeOnly = false): boolean {
    const latest = sessionStates(ctx).reverse().find((entry) => !sameRuntimeOnly || (entry as Record<string, unknown>)[STATE_RUNTIME_ID] === RUNTIME_ID);
    if (!latest) return false;
    state = latest;
    setStatus(ctx);
    return true;
  }

  function applyTools(): void {
    if (state.mode === "red") {
      if (!toolsBeforeRed) toolsBeforeRed = pi.getActiveTools();
      pi.setActiveTools(toolsBeforeRed.filter((name) => !WRITE_TOOLS.has(name)));
      return;
    }
    if (toolsBeforeRed) pi.setActiveTools(toolsBeforeRed);
  }

  function transition(transitionValue: Record<string, unknown>, ctx: ExtensionContext): void {
    const next = applyUserTransition(state, transitionValue, {}) as LightState;
    persist(next, ctx);
    applyTools();
    ctx.ui.notify(`Light set to ${next.mode}.`, "info");
  }

  pi.on("session_start", async (event, ctx) => {
    toolsBeforeRed = pi.getActiveTools();
    pendingRelease = undefined;
    reinjectAfterCompaction = false;
    if (event.reason === "startup" && restoreLatestSessionState(ctx, true)) {
      applyTools();
      return;
    }
    persist(createRedState(event.reason || "startup") as LightState, ctx);
    applyTools();
  });

  pi.on("session_compact", async () => {
    reinjectAfterCompaction = true;
  });

  pi.on("context", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    applyTools();
    if (!reinjectAfterCompaction) return;
    reinjectAfterCompaction = false;
    const authorityMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: renderAuthorityContext(state) }],
      timestamp: Date.now(),
    };
    let insertAt = 0;
    while ((event.messages[insertAt] as { role?: string } | undefined)?.role === "compactionSummary") insertAt += 1;
    return {
      messages: [
        ...event.messages.slice(0, insertAt),
        authorityMessage,
        ...event.messages.slice(insertAt),
      ],
    };
  });

  pi.on("input", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    applyTools();
    if (event.source !== "interactive" && event.source !== "rpc") return { action: "continue" as const };

    const slashMatch = event.text.replace(/\r\n/g, "\n").match(/^\/light(?:\s+([^\n]*))?(?:\n([\s\S]*))?$/i);
    if (slashMatch) {
      const parsedArgs = parseLightArgs(slashMatch[1] || "");
      if (!parsedArgs.ok) {
        ctx.ui.notify(parsedArgs.error, "warning");
        return { action: "handled" as const };
      }
      if (parsedArgs.status) {
        ctx.ui.notify(renderAuthorityContext(state), "info");
        return { action: "handled" as const };
      }
      transition(parsedArgs.transition as Record<string, unknown>, ctx);
      const task = (slashMatch[2] || "").trim();
      return task ? { action: "transform" as const, text: task } : { action: "handled" as const };
    }

    const parsed = parseTransitionMessage(event.text);
    if (!parsed) return { action: "continue" as const };
    if (parsed.error) {
      ctx.ui.notify(parsed.error, "warning");
      return { action: "handled" as const };
    }
    if (parsed.status) {
      ctx.ui.notify(renderAuthorityContext(state), "info");
      return { action: "handled" as const };
    }
    transition(parsed.transition as Record<string, unknown>, ctx);
    if (!parsed.task) return { action: "handled" as const };
    return { action: "transform" as const, text: parsed.task };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    applyTools();
    return {
      systemPrompt: `${event.systemPrompt}\n\n${renderAuthorityContext(state)}`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    applyTools();
    const decision = evaluateToolCall(event, state, { cwd: ctx.cwd });
    if (decision.resetToRed) {
      persist(createRedState("scope-drift") as LightState, ctx);
      applyTools();
    }
    if (!decision.allow) return { block: true, reason: decision.reason };
    if (decision.decorateDelegation && event.input && typeof event.input === "object") {
      decorateDelegation(event.input as Record<string, unknown>, state);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    const message = event.message as { role?: string };
    if (message.role !== "assistant" || state.mode !== "green") return;
    const release = detectRelease(messageText(event.message));
    pendingRelease = release === "complete" && state.releasePolicy === "manual" ? undefined : release;
  });

  pi.on("agent_end", async (event, ctx) => {
    restoreLatestSessionState(ctx);
    const messages = event.messages as Array<{ role?: string; stopReason?: string }> | undefined;
    const cancelled = messages?.some((message) => message.role === "assistant" && message.stopReason === "aborted") ?? false;
    const lastAssistant = [...(messages || [])].reverse().find((message) => message.role === "assistant");
    const release = detectRelease(messageText(lastAssistant));
    const releaseReason = release === "complete" && state.releasePolicy === "manual" ? undefined : release;
    const resetReason = pendingRelease || releaseReason || (cancelled ? "cancelled" : undefined);
    if (!resetReason || state.mode !== "green") return;
    persist(createRedState(resetReason) as LightState, ctx);
    pendingRelease = undefined;
    applyTools();
  });
}
