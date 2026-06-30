---
name: test
description: Run typecheck, lint, and tests for Intent IDE. Fixes any failures found.
---

# Test

## Steps

1. Run `npm run typecheck` first. Type errors cascade and cause false positives in later steps, so fix these before proceeding.

2. Run `npm run lint`. Fix any lint errors found.

3. Run `npm run test`. Fix any test failures.

4. For each failure:
   - Read the error output carefully.
   - Identify the root cause (not just the symptom).
   - Fix the source file, not the test (unless the test itself is wrong).
   - Re-run the failing command until it passes before moving to the next step.

5. After all three commands pass, report the results.

## Rules

- Always run in the order: typecheck, lint, test. Type errors must be resolved first.
- Do not skip a step even if a previous step passed.
- If a fix for one step breaks a previous step, go back and re-verify from the beginning.
