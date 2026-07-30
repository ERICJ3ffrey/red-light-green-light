<p align="center">
  <img src="assets/red-light-green-light-logo.svg" alt="red-light-green-light logo" width="160">
</p>

# red-light-green-light

AI coding agents often start editing while you are still thinking. `red-light-green-light` gives you explicit control over when the agent can research, plan, or build.

Every new session starts Red. Only you can change the light.

- **Red:** read, research, and plan in chat. No file edits.
- **Yellow:** write planning documents, but do not touch production files.
- **Green:** build. Use scoped Green for one task or `light green` to stay Green until you change it.

## Install

### Pi

```bash
pi install git:github.com/ERICJ3ffrey/red-light-green-light
```

Use:

```text
/light status
/light red
/light yellow docs/plans
/light green implement the approved plan
/light green implement the approved plan --paths src/auth.js,tests/auth.test.js
```

Pi displays the active light in its footer.

### Claude Code

```bash
claude plugin marketplace add ERICJ3ffrey/red-light-green-light
claude plugin install red-light-green-light@red-light-green-light
```

Restart Claude Code and confirm the plugin hooks are enabled in `/hooks`.

```text
/red-light-green-light:light status
/red-light-green-light:light yellow docs/plans
/red-light-green-light:light green implement the approved plan
```

### Codex

```bash
codex plugin marketplace add ERICJ3ffrey/red-light-green-light --ref master
codex plugin add red-light-green-light@red-light-green-light
```

Restart Codex, open `/hooks`, and trust the plugin hooks.

Codex does not support plugin-defined `/light` commands. Use:

```text
light status
light red
light yellow docs/plans
light green
light green for implement the approved plan
```

These controls work from Red, Yellow, or Green. `light green` stays Green until you select another light. To disable the plugin, open `/plugins`, select `red-light-green-light`, and press Space.

Codex does not currently let plugins add a custom footer item, so use `light status` to check the active light.

## Enforcement

| Capability | Pi | Claude Code | Codex | Agent Skill only |
|---|---|---|---|---|
| Automatic startup Red | Native, verified | Native hook | Native hook after trust | No |
| User-only transitions | Native, verified | `UserPromptSubmit` hook | `UserPromptSubmit` hook | Instruction guarded |
| Red direct-write blocking | Mechanically guarded | Intercepted local tools | Intercepted local tools | Instruction guarded |
| Yellow planning paths | Mechanically guarded | Intercepted file tools | Intercepted `apply_patch` | Instruction guarded |
| Path-bound Green | Direct file tools | Intercepted file tools | Parsed `apply_patch` targets | Instruction guarded |
| Semantic or manual Green | Instruction guarded | Instruction guarded | Instruction guarded | Instruction guarded |
| Protected command families | Blocked in every light | Blocked when intercepted | Blocked when intercepted | Instruction guarded |
| Unclassified intercepted tools | Fail closed | Fail closed | Fail closed | Harness dependent |

Green does not authorize commits, pushes, dependency installation, deployments, publishing, external sends, purchases, destructive operations, or credential changes. Use a separate user-controlled channel for those actions.

This package is a tool-call authorization layer, not an OS sandbox. See [SECURITY.md](SECURITY.md) for the enforcement boundary and residual risks.

## License

MIT
