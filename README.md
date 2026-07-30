# red-light-green-light

AI coding agents start building while you are still thinking. `red-light-green-light` lets you decide when they can research, plan, or act.

Every session starts Red. Only you can change the light.

- **Red:** read, research, discuss, and plan in chat. No changes.
- **Yellow:** write planning documents. No production changes.
- **Green:** execute the task. Green means Green.

## Install

### Pi

```bash
pi install git:github.com/ERICJ3ffrey/red-light-green-light
```

```text
/light status
/light red
/light yellow docs/plans
/light green
/light green for implement the approved plan
```

Pi shows the active light in its footer.

### Claude Code

```bash
claude plugin marketplace add ERICJ3ffrey/red-light-green-light
claude plugin install red-light-green-light@red-light-green-light
```

Restart Claude Code and enable the hooks in `/hooks`.

Claude namespaces plugin slash commands, so use the plain controls instead:

```text
light status
light red
light yellow docs/plans
light green
light green for implement the approved plan
```

### Codex

```bash
codex plugin marketplace add ERICJ3ffrey/red-light-green-light --ref master
codex plugin add red-light-green-light@red-light-green-light
```

Restart Codex and trust the hooks in `/hooks`.

```text
light status
light red
light yellow docs/plans
light green
light green for implement the approved plan
```

Codex does not support plugin-defined `/light` commands or custom footer items. Use `light status` to check the active light. Disable the plugin through `/plugins`.

## Green means Green

Semantic or manual Green allows the tools needed for the user's request, including Git operations, dependency changes, deployments, publishing, sends, and destructive commands. Scoped Green stays inside its named scope. Path-bound Green stays inside its file allowlist.

The host may still show its own confirmation prompt. This package does not bypass host permissions or the operating system.

## Enforcement

- Pi, Claude Code, and Codex start Red through native adapters.
- Red and Yellow are mechanically guarded where the host exposes tool hooks.
- Semantic scope is instruction guarded. Path-bound file writes are mechanically guarded.
- Protected and unclassified tools are **Allowed in Green** and blocked in Red and Yellow.
- This is a tool-call authorization layer, not an OS sandbox. See [SECURITY.md](SECURITY.md).

## License

MIT
