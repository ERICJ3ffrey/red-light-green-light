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

Green means execution authority. It has two user-selected forms:

- **Manual Green:** clear user phrasing such as `light green`, `green light`, `greenlit`, or `let it rip` enables Green for successive user-directed tasks until the user changes the light. Do not invent adjacent work.
- **Scoped Green:** if the user names a scope, perform any action needed inside that scope, including commands, dependency changes, Git operations, deployments, publishing, sends, and other external side effects. Do not perform adjacent work or expand the scope.

Green removes this skill's restrictions for the user's requested work. The host may still require its own confirmation for sensitive actions; this skill does not bypass host or operating-system controls.

Scoped Green persists while its scope is incomplete and unblocked. When a scoped Green task completes or cannot continue, end the response with exactly one marker:

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

- `/light red`, exact `red light`, or exact `light red` sets Red immediately.
- `/light yellow [planning-path]`, `yellow light [planning-path]`, or `light yellow [planning-path]` sets Yellow.
- `/light green [scope]` sets Green immediately; without a scope it sets manual Green.
- `/light green <scope> --paths path-one,path-two` sets scoped path-bound Green.
- `green light`, `light green`, `greenlit`, `greenlight this`, `let it rip`, or `scope is to <scope>` set Green immediately.
- `green light for <scope>`, `light green for <scope>`, or `go ahead and <scope>` set scoped semantic Green.
- `/light status` or exact `light status` reports the active mode and scope information.
- New, resumed, forked, or reloaded sessions start Red.
- Compaction never increases authority.

A user message containing only a transition changes authority only; acknowledge it and wait for a separate user task. If the transition includes task text on following lines, continue with that task under the new authority. Manual Green remains active across completed tasks until the user selects Red or Yellow. Light controls are accepted from every current light.

The agent may recommend a transition. It cannot grant Yellow, grant Green, or redirect Green. Subagents inherit the parent's light and scope and cannot increase them.

## Enforcement

Native adapters may block tools mechanically. A plain Agent Skills installation is instruction guarded. Green removes this skill's restrictions, but host-level confirmations and operating-system permissions still apply.

## Red flags

Stop and return to Red when reasoning includes:

- “The plan is approved, so execution is implied.”
- “This edit is tiny.”
- “While I am here.”
- “The deadline makes confirmation impractical.”
- “The user probably meant Green” when the user did not use a clear Green cue.
- “The child agent can decide.”

None of these grants authority.
