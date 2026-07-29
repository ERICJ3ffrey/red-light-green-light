import { handleHook } from "./lib/hook-runtime.mjs";

const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "SubagentStart", "Stop"]);
const eventName = process.argv[2];

if (!EVENTS.has(eventName)) {
  process.stderr.write("Red Light Green Light requires a valid lifecycle event argument.\n");
  process.exitCode = 2;
} else {
  let input = "";
  let finished = false;

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (!finished) input += chunk;
  });

  const finish = async ({ fallback = false } = {}) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.stdin.pause();
    if (fallback) process.stdin.destroy();

    let payload;
    try {
      let text = input;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      payload = JSON.parse(text.trim());
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("Hook input must be one JSON object.");
      }
    } catch {
      payload = null;
    }

    let handled;
    try {
      handled = await handleHook(eventName, payload, process.env);
    } catch {
      handled = await handleHook(eventName, null, process.env);
    }

    if (handled.output
      && typeof handled.output === "object"
      && !Array.isArray(handled.output)
      && Object.keys(handled.output).length > 0) {
      process.stdout.write(JSON.stringify(handled.output));
    }
    if (typeof handled.stderr === "string" && handled.stderr) {
      process.stderr.write(handled.stderr);
    }
    process.exitCode = Number.isInteger(handled.exitCode) ? handled.exitCode : 2;
  };

  const timer = setTimeout(() => {
    void finish({ fallback: true });
  }, 1000);
  timer.unref();

  process.stdin.once("end", () => {
    void finish();
  });
  process.stdin.once("error", () => {
    void finish({ fallback: true });
  });
  process.stdin.resume();
}
