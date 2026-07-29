# Contributing

## Development setup

Requires Node.js 22 or newer. The repository has no install-time development dependencies.

```bash
npm test
npm run validate
npm pack --dry-run --json
```

For Claude adapter changes, also run:

```bash
claude plugin validate . --strict
```

## Rules

- Follow test-driven development: reproduce the failure before changing implementation.
- Keep the complete protocol in `skills/red-light-green-light/SKILL.md` only.
- Keep native manifests, hooks, and commands thin.
- Do not claim mechanical enforcement without pre-execution interception and acceptance evidence.
- Unknown or malformed mutating operations must fail closed.
- Preserve Windows and Unix behavior.
- Do not add dependencies unless the change cannot be implemented safely with Node's standard library.
- Keep commits focused and include the commands and results used for verification.

## Adapter changes

Every native adapter change needs fixtures for its actual event schema and a clean-profile acceptance record containing the host version, installation method, transcript, final diff, and observed enforcement rating.

Do not weaken the shared policy to make a host-specific acceptance test pass. Document a weaker enforcement tier when the host lacks the required interception point.

## Pull requests

Explain the authority or distribution behavior changed, link the failing test that motivated it, list security assumptions, and include fresh verification output. Never include credentials, personal host configuration, or generated session secrets.
