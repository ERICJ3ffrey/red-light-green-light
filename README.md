<p align="center">
  <img src="assets/red-light-green-light-logo.svg" alt="red-light-green-light logo" width="160">
</p>

# red-light-green-light

AI coding agents start building while you are still thinking. `red-light-green-light` gives them traffic lights.

Every session starts Red. Only you can change the light.

- **Red:** read, research, discuss, and plan in chat. No changes.
- **Yellow:** write planning docs. No production changes.
- **Green:** execute the task. Green means Green.

## Install

Pick your harness:

```bash
# Pi
pi install git:github.com/ERICJ3ffrey/red-light-green-light

# Claude Code
claude plugin marketplace add ERICJ3ffrey/red-light-green-light
claude plugin install red-light-green-light@red-light-green-light

# Codex
codex plugin marketplace add ERICJ3ffrey/red-light-green-light --ref master
codex plugin add red-light-green-light@red-light-green-light
```

For Claude Code or Codex, restart the app and enable/trust the hooks when prompted.

## Use

Pi supports `/light ...`:

```text
/light status
/light red
/light yellow docs/plans
/light green
/light green for implement the approved plan
/light green implement the approved plan --paths src/auth.js
```

Claude Code and Codex use plain text controls:

```text
light status
light red
light yellow docs/plans
light green
green light
greenlit
greenlight this
let it rip
scope is to implement the approved plan
go ahead and implement the approved plan
```

`light green` and other manual Green phrases stay Green until you change the light. Scoped Green releases when its named task completes or blocks.

## What it enforces

- New sessions start Red.
- Red blocks edits and mutating commands.
- Yellow allows planning docs only.
- Green allows execution, including Git, installs, deploys, sends, and destructive commands if the user asked for them.
- Semantic/manual Green allows protected commands and unclassified tools.
- Path-bound Green can mechanically restrict file writes to allowed paths.

This is a tool-call authorization layer, not an OS sandbox. Host confirmation prompts and operating-system permissions still apply.

## License

MIT
