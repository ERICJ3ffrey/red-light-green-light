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

- **Scoped Green:** perform any action needed inside the user-named scope, including commands, dependency changes, Git operations, deployments, publishing, sends, and other external side effects. Do not perform adjacent work or expand the scope.
- **Manual Green:** exact `light green` enables full execution authority for successive user-directed tasks until the user changes the light. Do not invent adjacent work.

Green removes this skill's restrictions. The host may still require its own confirmation for sensitive actions; this skill does not bypass host or operating-system controls.

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
- `/light green <scope>` sets scoped semantic Green.
- `/light green <scope> --paths path-one,path-two` sets scoped path-bound Green.
- Exact `green light for <scope>` or `light green for <scope>` sets scoped semantic Green.
- Exact `light green` sets manual Green until the user selects another light.
- `/light status` or exact `light status` reports the active mode and scope information.
- New, resumed, forked, or reloaded sessions start Red.
- Compaction never increases authority.

A user message containing only a transition changes authority only. Acknowledge the new mode without tools or implementation, then wait for a separate user task. Manual Green remains active across completed tasks until the user selects Red or Yellow. Light controls are accepted from every current light.

The agent may recommend a transition. It cannot grant Yellow, grant Green, or redirect Green. Subagents inherit the parent's light and scope and cannot increase them.

## Enforcement

Native adapters may block tools mechanically. A plain Agent Skills installation is instruction guarded. Green removes this skill's restrictions, but host-level confirmations and operating-system permissions still apply.

## Red flags

Stop and return to Red when reasoning includes:

- “The plan is approved, so execution is implied.”
- “This edit is tiny.”
- “While I am here.”
- “The deadline makes confirmation impractical.”
- “The user probably meant Green.”
- “The child agent can decide.”

None of these grants authority.
