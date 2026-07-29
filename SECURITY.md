# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | Yes |
| 0.1.x | No |

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/ERICJ3ffrey/red-light-green-light/security/advisories/new). Do not open a public issue for an unpatched vulnerability.

Include the affected harness and version, operating system, active light, exact tool payload or command, expected decision, observed result, and a minimal reproduction when possible.

## Security boundary

`red-light-green-light` is a host tool-call authorization layer, not an operating-system sandbox. Reports about bypasses in intercepted tool paths, authority escalation, path containment, hook output, state isolation, or protected-command classification are in scope.

Concurrent hostile filesystem mutation, compromised hosts or plugins, semantic scope interpretation, transitive behavior hidden inside allowed programs, and tool paths that the host does not expose to lifecycle hooks are documented residual risks rather than guaranteed isolation boundaries.
