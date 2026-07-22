---
name: loop-detection
description: Detects stagnation loops — not all repetition is a loop. Distinguishes productive iteration from spinning. Uses human-in-the-loop when stuck.
---

# Loop Detection (Improved)

## Core Principle

**Repetition is not inherently bad.** Iterating on a solution, refining an approach, or trying variations is productive. The signal for a loop is _stagnation_ — the same failure state repeating without progress or new information.

## Loop Taxonomy

### ✅ Productive Iteration (NOT a loop)

- Trying different approaches after each failure
- Refining a solution based on new feedback
- Reading the same file after making changes to it
- Asking follow-up questions to clarify understanding
- Multiple passes over code during a complex refactor

### 🔄 Stagnation Loop (REAL loop)

- Same command failing with same error, agent retries unchanged
- Same question asked after user already answered
- Same fix proposed after user explicitly rejected it
- Re-reading unchanged files without new context needed
- Same error appearing after "fix" that didn't address root cause

## Detection Patterns

### Pattern 1: Failed Action Repetition

```
IF  (same action attempted ≥ 2 times)
AND (same error/outcome each time)
AND (no code changes between attempts)
THEN → Stagnation loop detected
```

### Pattern 2: Ignored User Feedback

```
IF  (user said "no" / "that didn't work" / "try X")
AND (agent proposes same rejected approach)
THEN → Stagnation loop detected
```

### Pattern 3: Re-Answering Answered Questions

```
IF  (agent asks clarifying question)
AND (user already answered that question in this thread)
AND (answer wasn't addressed/used)
THEN → Stagnation loop detected
```

### Pattern 4: File Read Without Progress

```
IF  (agent reads file)
AND (file content unchanged since last read)
AND (no meaningful work happened between reads)
THEN → Stagnation loop detected
```

## Response Strategy

### When stagnation detected:

1. **STOP** — Don't continue the failing action
2. **ACKNOWLEDGE** — State what's happening clearly
3. **SUMMARIZE** — What was tried, what failed, what constraints exist
4. **ASK** — Explicitly request human direction

### Template response:

```
I notice I'm stuck in a loop. Here's where we are:

**Tried:**
1. [approach 1] → [result]
2. [approach 2] → [result]
3. [approach 3] → [result]

**Constraint:** [what the user said doesn't work]

**What I need from you:**
- Should I try [new direction A]?
- Or do you have a different approach in mind?
```

## Thresholds

| Situation              | Threshold           | Action                              |
| ---------------------- | ------------------- | ----------------------------------- |
| Same command failing   | 2 failures          | Stop, diagnose why before retrying  |
| User-rejected approach | 1 rejection         | Never re-propose without new info   |
| Clarifying question    | Already answered    | Use the answer, don't re-ask        |
| File re-read           | Unchanged content   | Stop; you have what you need        |
| General spinning       | 3 no-progress turns | Pause, summarize, ask for direction |

## Prevention Rules

1. **After 2 failures of same action:** "This isn't working because [reason]. Let me try [different approach]."
2. **When user provides info:** Actually use it before asking for more.
3. **When uncertain:** Ask once, clearly. Don't hedge with re-asks.
4. **After any rejection:** Acknowledge the constraint explicitly before proposing something new.

## What this is NOT

- Not a hard block on all repeated strings
- Not a counter that fires at exactly N identical messages
- Not permission to keep trying the same thing "one more time"
- Not a substitute for actually diagnosing why something failed
