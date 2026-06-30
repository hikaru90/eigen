---
name: loop-detection
description: Detects when the agent is stuck in a loop — repeating the same question, suggestion, or failed approach. Stops after 3 iterations and asks the user for direction.
---

# Loop Detection

## Rule

**If you find yourself repeating the same action, question, or suggestion more than 3 times without progress, STOP immediately.**

## What counts as a loop

- Asking the user to run the same command more than once
- Suggesting the same fix after it already failed
- Reading the same file repeatedly without finding new information
- Proposing the same approach after the user rejected it
- Going back to a previous step without clear reason

## What to do when a loop is detected

1. **Stop the current action**
2. **Acknowledge the loop:** "I notice I'm repeating myself. Let me take a different approach."
3. **Summarize what we've tried:** List the 3+ attempts
4. **Ask the user:** "What should I try next?" or "Can you paste the actual error output?"

## Example

```
I notice I've asked you to run `docker compose logs app` three times now.
Here's what we've tried:
1. Checked migration state — all clean
2. Added client-side error logging
3. Asked for server logs

I'm stuck. Can you paste the server-side error output from `docker compose logs app --tail=50`?
```

## Prevention

- After 2 failed attempts at the same thing, explicitly state: "This isn't working. Let me try a different angle."
- Keep a mental checklist of what you've already tried
- If the user provides new information, don't re-ask for the same old information
