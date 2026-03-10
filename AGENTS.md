## Required Startup Reads

Before making code changes or answering behavior/spec questions in this workspace, read:

- `LEGACY_SCREEN_SPEC.md`
- `NEW_SCREEN_SPEC.md`
- `DAILY_SUMMARY_FIELD_SPEC.md`

Treat these files as the primary local product specifications.

## Existing Logic Changes

When a task involves changing existing logic, do not jump directly to implementation.

First:

- investigate the current behavior
- identify the relevant existing flow
- report the current behavior/specification to the user

Then:

- propose how the specification should be changed
- ask the user to confirm that specification change
- make changes only after that confirmation

This rule is especially important for:

- legacy screen behavior
- new screen ingest behavior
- `daily_summary` creation/update logic
- debug/sync/clear operations
- specification markdown updates

## No Implicit Fallback

Do not invent or assume fallback behavior when the specification is unclear.

If the current specification is missing, inconsistent, or appears wrong:

- investigate the existing behavior
- explain the current behavior
- explain how the specification would need to change
- ask the user before implementing the change

## Specification Markdown Updates

When updating specification markdown files such as:

- `LEGACY_SCREEN_SPEC.md`
- `NEW_SCREEN_SPEC.md`
- `DAILY_SUMMARY_FIELD_SPEC.md`

do not edit them silently.

First:

- report that the markdown/specification itself needs to be updated
- explain what part of the specification would change

Then:

- wait for the user's confirmation
- update the markdown only after that confirmation
