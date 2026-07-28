# Enforcement labels

## Mechanically guarded mode

The adapter intercepts file-write, shell, and unknown custom tools before execution. Red blocks writes. Yellow restricts writes to planning artifacts. Green restores implementation authority within the recorded scope.

## Path-bound Green

The user or approved plan supplies an enforceable file allowlist. The adapter blocks direct file writes outside it. Shell mutation remains restricted because shell commands can bypass path guards.

## Semantic Green

The user supplies a natural-language scope without a reliable file allowlist. The adapter enforces mode mechanically and scope through instructions and drift checks. Do not describe semantic scope as mechanically guaranteed.

## Instruction guarded

The harness loads the protocol automatically but cannot intercept every tool. The model follows the rules, but prohibited actions are not technically impossible.

## Agent Skills only

The harness discovers the skill on demand. This does not provide always-on startup activation.

## Protected actions in Stage 1 Pi

The native Pi adapter does not encode one-off approvals for protected shell actions. Recognized commits, pushes, dependency operations, deployments, and other protected families remain blocked in every light. An approved protected action must use a separate user-controlled channel.

## Stage 1 threat model

Stage 1 mediates agent-issued Pi tool calls in the current session. Its mechanical target and command restrictions are not an OS sandbox or an atomic check-and-use filesystem authorization. Concurrent filesystem mutation by an external actor or compromised extension is outside the Stage 1 threat model.

Traversal and symlink escapes present at evaluation are denied. Semantic Green remains instruction-scoped. Protected enforcement blocks recognized direct families and dynamic wrappers, but cannot prove the transitive behavior of every directly allowed executable, script, plugin, or service.
