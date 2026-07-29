const MODES = new Set(["red", "yellow", "green"]);
const RELEASE_RE = /(?:^|\n)LIGHT_RELEASE:\s*(complete|blocked|cancelled|scope-drift)\s*$/i;

export function createRedState(resetReason = "startup", now = new Date().toISOString()) {
  return { mode: "red", resetReason, grantedAt: now };
}

export function parseLightArgs(raw) {
  const text = String(raw || "").trim();
  const [modeRaw = "", ...rest] = text.split(/\s+/);
  const mode = modeRaw.toLowerCase();
  const value = rest.join(" ").trim();

  if (!MODES.has(mode) && mode !== "status") {
    return { ok: false, error: "Use /light red, /light yellow [planning-path], /light green <scope>, or /light status." };
  }
  if (mode === "status") return { ok: true, status: true };
  if (mode === "green" && !value) return { ok: false, error: "Green requires a scope." };
  if (mode === "red") return { ok: true, transition: { mode: "red" } };
  if (mode === "yellow") {
    return { ok: true, transition: value ? { mode: "yellow", planningPath: value } : { mode: "yellow" } };
  }
  const marker = value.match(/(^|\s)--paths(?=\s|$)/);
  if (!marker) return { ok: true, transition: { mode: "green", scope: value } };
  const markerIndex = marker.index;
  const scope = value.slice(0, markerIndex).trim();
  const allowedPaths = value.slice(markerIndex + marker[0].length).split(",").map((item) => item.trim()).filter(Boolean);
  if (!scope) return { ok: false, error: "Green requires a scope." };
  if (!allowedPaths.length) return { ok: false, error: "--paths requires at least one path." };
  return { ok: true, transition: { mode: "green", scope, allowedPaths } };
}

export function parseTransitionMessage(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return undefined;
  const [firstLine, ...remaining] = text.split("\n");
  const line = firstLine.trim();
  let parsed;

  if (/^\/light\s+/i.test(line)) {
    parsed = parseLightArgs(line.replace(/^\/light\s+/i, ""));
  } else if (/^light\s+/i.test(line)) {
    const match = line.match(/^light\s+(red|yellow|green|status)(?:\s+(.+))?$/i);
    if (!match) return undefined;
    const mode = match[1].toLowerCase();
    let value = match[2]?.trim() || "";
    if (mode === "green" && /^for\s+/i.test(value)) value = value.replace(/^for\s+/i, "");
    parsed = mode === "green" && !value
      ? { ok: true, transition: { mode: "green", scope: "user-enabled Green mode", releasePolicy: "manual" } }
      : parseLightArgs(`${mode}${value ? ` ${value}` : ""}`);
  } else if (/^red light$/i.test(line)) {
    parsed = { ok: true, transition: { mode: "red" } };
  } else if (/^yellow light(?:\s+(.+))?$/i.test(line)) {
    const match = line.match(/^yellow light(?:\s+(.+))?$/i);
    parsed = { ok: true, transition: match?.[1] ? { mode: "yellow", planningPath: match[1].trim() } : { mode: "yellow" } };
  } else if (/^green light(?:\s+for)?\s+(.+)$/i.test(line)) {
    const match = line.match(/^green light(?:\s+for)?\s+(.+)$/i);
    parsed = { ok: true, transition: { mode: "green", scope: match[1].trim() } };
  } else {
    return undefined;
  }

  const task = remaining.join("\n").trim();
  if (!parsed.ok) return { error: parsed.error, task };
  if (parsed.status) return { status: true, task };
  if (!parsed.transition) return undefined;
  return { transition: parsed.transition, task };
}

export function applyUserTransition(_current, transition, options = {}) {
  const now = options.now || new Date().toISOString();
  if (transition.mode === "red") return createRedState("user", now);
  if (transition.mode === "yellow") {
    return {
      mode: "yellow",
      planningPaths: transition.planningPath ? [transition.planningPath] : [],
      grantedAt: now,
      grantedByUserEntry: options.userEntry,
    };
  }
  if (transition.mode !== "green") throw new Error(`Unknown light mode: ${transition.mode}`);
  if (!transition.scope?.trim()) throw new Error("Green requires a scope.");
  const allowedPaths = options.allowedPaths?.length ? options.allowedPaths : transition.allowedPaths;
  return {
    mode: "green",
    scope: transition.scope.trim(),
    scopeEnforcement: allowedPaths?.length ? "path-bound" : "semantic",
    allowedPaths: allowedPaths?.length ? [...allowedPaths] : undefined,
    releasePolicy: transition.releasePolicy === "manual" ? "manual" : undefined,
    grantedAt: now,
    grantedByUserEntry: options.userEntry,
  };
}

export function detectRelease(text) {
  return String(text || "").match(RELEASE_RE)?.[1];
}

export function renderAuthorityContext(state) {
  const protectedBoundary = "Recognized protected actions remain blocked by the Stage 1 adapter in every light; use a separate user-controlled channel.";
  const redContext = `[RED LIGHT GREEN LIGHT: RED]\nRead, research, and discuss only. Do not create or edit files or run mutating commands.\n${protectedBoundary}`;
  if (state?.mode === "red") return redContext;
  if (state?.mode === "yellow") {
    const header = "[RED LIGHT GREEN LIGHT: YELLOW]";
    const roots = state.planningPaths?.length ? state.planningPaths.join(", ") : "configured planning roots";
    return `${header}\nPlanning writes are allowed only under: ${roots}. Production source, tests, runtime config, dependencies, human data, and external side effects remain blocked.\n${protectedBoundary}`;
  }
  if (state?.mode === "green") {
    const header = "[RED LIGHT GREEN LIGHT: GREEN]";
    const allowedPaths = state.scopeEnforcement === "path-bound"
      ? `\nAllowed paths: ${state.allowedPaths?.join(", ") || "(none)"}`
      : "";
    if (state.releasePolicy === "manual") {
      return `${header}\nUser-enabled Green mode is active. Follow the user's current requests without inventing adjacent work.${allowedPaths}\nThis mode remains Green until the user changes the light. Do not emit a completion release marker merely because one task finishes.\n${protectedBoundary}`;
    }
    return `${header}\nAuthorized scope: ${state.scope}\nScope enforcement: ${state.scopeEnforcement}.${allowedPaths} Do not widen scope. When complete or blocked, end with LIGHT_RELEASE: complete or LIGHT_RELEASE: blocked.\n${protectedBoundary}`;
  }
  return redContext;
}
