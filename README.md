# Red Light Green Light

User-controlled authority for AI coding agents.

## Protocol

- **Red:** read, research, and discuss. No file writes or mutating commands.
- **Yellow:** Red plus planning artifacts under approved planning paths.
- **Green:** implementation inside one user-named scope.

Only user input can increase or redirect authority. Completion, blockage, cancellation, or scope drift returns Green to Red. New, resumed, forked, and reloaded Pi sessions start Red.

## Pi installation

```bash
pi install git:github.com/ERICJ3ffrey/red-light-green-light
```

Try a local checkout without installing:

```bash
pi -e "C:/path/to/red-light-green-light"
```

Remove:

```bash
pi remove git:github.com/ERICJ3ffrey/red-light-green-light
```

## Commands

```text
/light red
/light yellow [planning-path]
/light green <scope>
/light green <scope> --paths path-one,path-two
/light status
```

Pure exact natural-language transitions also work:

```text
red light
yellow light docs/plans
green light for implement docs/plans/auth.md
```

## Pi enforcement rating

| Layer | Rating | Meaning |
|---|---|---|
| Startup | Native | Every new, resumed, forked, or reloaded session starts Red |
| Red mode | Mechanically guarded | Direct writes and mutating shell commands are blocked |
| Yellow mode | Mechanically guarded | Writes are restricted to planning artifacts; shell access remains read-only |
| Path-bound Green | Mechanically guarded for direct file tools | Writes outside the allowlist are blocked; mutating Bash stays disabled |
| Semantic Green | Instruction guarded scope | Mode is mechanical; natural-language scope is not a technical sandbox |
| Delegated work | Instruction guarded | The parent injects authority into known Pi subagent task fields |

Unknown custom tools fail closed. Add an explicit classification before using them.

## Protected actions

Green does not automatically approve deployments, publishing, external sends, purchases, dependency installation, destructive operations, commits, pushes, or credential or configuration changes. Recognized protected command families and dynamic dispatch wrappers are blocked.

## Stage 1 threat model

Stage 1 mediates agent-issued Pi tool calls in the current session. It mechanically restricts built-in file-write targets and a deliberately limited command subset. It is **not an OS sandbox** and does not provide atomic check-and-use filesystem authorization.

Traversal and symlink escapes present when authorization is evaluated are denied. Concurrent external filesystem mutation, a compromised extension, or another actor that changes path components between authorization and built-in tool execution is outside the Stage 1 threat model.

Semantic Green remains instruction scoped. Protected-command enforcement blocks recognized direct command families and dynamic wrappers, but cannot prove the transitive behavior of every directly allowed executable, script, plugin, or external service.

## Agent Skills compatibility

The canonical skill lives at `skills/red-light-green-light/SKILL.md`. Harnesses that install only the Agent Skill receive on-demand instructions, not native always-on enforcement.

## Development

```bash
npm test
npm run validate
```

The pressure-test runners use fresh Pi RPC sessions and preserve separate authority-initialization and evaluated user turns:

```bash
node evals/run-baseline.mjs <case-id>
node evals/run-with-skill.mjs <case-id>
```

## Roadmap

Stage 1 supports Pi. Later tested adapters will add Claude Code, Codex, Gemini CLI, Cursor, and Grok without duplicating the canonical skill.

## License

MIT
