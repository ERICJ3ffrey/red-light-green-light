---
name: red-light-green-light
description: Use when the user cues authority discovery or mentions red light, yellow light, green light, research-only or no-edit boundaries, planning-only work, implementation authorization, permission scope, or execution boundaries.
license: MIT
---

# Red Light Green Light

## Core rule

Only the user may increase or redirect authority. Runtime safety events may reduce authority to Red. Never infer Green from urgency, an approved idea, an implementation plan, prior work, or generic words such as “go” or “continue.”

## Lights

### Red

Read, search, research, discuss, and plan in chat. Do not create or edit files. Do not run mutating commands or external actions.

### Yellow

Red permissions plus planning artifacts under approved planning paths. Specs, plans, reviews, checklists, handoffs, and implementation contracts are allowed. Production source, tests, runtime configuration, dependencies, human data, and external side effects remain blocked.

### Green

Implement only the user-named scope. Do not perform adjacent cleanup, scope expansion, dependency changes, protected Git operations, sends, publishing, deployment, purchases, or destructive actions without their separate approvals.

Green persists while its scope is incomplete and unblocked. When the scope completes or cannot continue, end the response with exactly one marker:

```text
LIGHT_RELEASE: complete
```

or

```text
LIGHT_RELEASE: blocked
```

Scope drift requires Red before asking for wider authority:

```text
LIGHT_RELEASE: scope-drift
```

A prose claim such as “I am back at Red” does not release Green. The final non-blank line must be exactly one `LIGHT_RELEASE` marker.

## Transitions

- `/light red` or exact “red light” sets Red immediately.
- `/light yellow [planning-path]` sets Yellow.
- `/light green <scope>` sets semantic Green.
- `/light green <scope> --paths path-one,path-two` sets path-bound Green.
- Exact “green light for <scope>” sets semantic Green.
- `/light status` reports mode, planning paths, scope, and enforcement class.
- New, resumed, forked, or reloaded sessions start Red.
- Compaction never increases authority.

The agent may recommend a transition. It cannot grant Yellow, grant Green, or redirect Green. Subagents inherit the parent's light and scope and cannot increase them.

## Enforcement

Native adapters may block tools mechanically. A plain Agent Skills installation is instruction guarded. See [references/enforcement.md](references/enforcement.md) for the support labels.

## Red flags

Stop and return to Red when reasoning includes:

- “The plan is approved, so execution is implied.”
- “This edit is tiny.”
- “While I am here.”
- “The deadline makes confirmation impractical.”
- “The user probably meant Green.”
- “The child agent can decide.”

None of these grants authority.
