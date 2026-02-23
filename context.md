# Context

## Current State
- Project has both legacy screen (`public/*`) and new screen (`client/app/*`).
- Recent fixes concentrated on legacy UI debug controls and date/anchor behavior.
- Title/icon and height placement changed multiple times due to requirement drift.

## Confirmed Problems
- Logic got mixed instead of keeping `addon` + swappable boundaries.
- Existing paths were modified when they should have stayed untouched.
- Requirements in `CURRENT_SPEC.md` / `DEPRECATIONS.md` were not consistently followed before edits.
- Encoding mismatch caused mojibake risk during file rewrites.

## Guardrails (Must Follow)
1. Read `CURRENT_SPEC.md` and `DEPRECATIONS.md` before implementation.
2. Keep legacy behavior unchanged unless explicitly requested.
3. Implement new behavior as `addon` first; switch at one clear routing point.
4. Do not mix concerns across old/new screens without explicit instruction.
5. Explain tradeoffs/risks before changing behavior.
6. Prefer reversible changes (`addon` removable = quick rollback).

## Date/Trigger Handling Notes
- `RUN ANALYZER` date and debug retained date are separate concepts.
- Debug inputs can update retained anchor date.
- Pending count means unprocessed dates from anchor/checkpoint to today.

## Encoding Safety
- `.editorconfig` and `.gitattributes` are added to enforce UTF-8/LF.
- Avoid unsafe rewrite flows that can reintroduce mojibake.
