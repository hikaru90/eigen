---
name: no-mid-air-rethinks
description: Prevents stopping mid-implementation to reconsider the entire approach. Once you commit to a plan, execute it fully. Rethinking belongs before implementation, not during.
---

# No Mid-Air Rethinks

## The Rule

**Once you start implementing, do not stop to "rethink everything."** Rethinking belongs before implementation, not during.

## What this means

If you're writing code and suddenly think "wait, maybe this is wrong" — that's a sign you didn't understand the problem well enough before starting. The fix is not to stop mid-air and announce a rethink. The fix is to finish what you started, then evaluate the result.

## The Anti-Pattern

```
# This is WRONG:
1. Read code
2. Start implementing a fix
3. Mid-implementation: "Wait - I just realized something..."
4. Stop implementing
5. Start explaining why the whole approach might be wrong
6. Leave the user with half-written code and no resolution
```

This wastes the user's time and creates confusion. You've now done the reading, started the work, and abandoned it — accomplishing nothing.

## Why this happens

- You started implementing before fully understanding the problem
- You made assumptions during reading that you didn't verify
- You conflated "understanding more" with "the original understanding was wrong"

## What to do instead

### Before implementing (the right time to rethink)

- Read the code
- Trace the data flow
- Verify your assumptions
- **If something doesn't make sense, stop and ask the user** — don't start implementing while uncertain

### During implementing (too late to rethink)

- **Finish the implementation** — complete what you started
- **Then evaluate** — does the result solve the problem?
- **If it doesn't work**, you now have concrete information about what went wrong
- **Then** you can rethink with evidence, not speculation

### If you realize mid-implementation that your understanding was wrong

1. **Do not announce a rethink** — this creates anxiety and wastes time
2. **Continue to a stopping point** — finish the current edit or step
3. **Test or verify** — check if the implementation works
4. **If it fails**, you now have a real error to debug, not a hypothetical concern
5. **If it succeeds**, your "realization" was probably wrong

## Forbidden patterns

- ❌ "Wait - I just realized something..."
- ❌ "Let me re-read this..."
- ❌ "Actually, I think the issue is..."
- ❌ Stopping mid-edit to explain why the edit might be wrong
- ❌ Abandoning a plan halfway through because of a new hypothesis

## Acceptable exceptions

- **You hit a hard error** — if the code won't compile or a test fails, stop and debug
- **The user interrupts** — if the user says "stop, that's wrong," you stop
- **You discover a blocker** — if you need information you don't have (a password, a config value), stop and ask

## How to check yourself

Before starting implementation, ask:
1. Do I understand the problem fully?
2. Do I understand the code I'm about to change?
3. Am I confident this fix addresses the root cause?
4. Do I have any open questions?

If any answer is "no" — ask the user or keep reading. Do not start implementing while uncertain.

## Recovery if you catch yourself mid-rethink

1. Stop talking
2. Finish the current step
3. Test the result
4. Then explain what you found — with evidence, not speculation
