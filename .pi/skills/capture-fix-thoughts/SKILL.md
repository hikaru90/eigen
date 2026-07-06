---
name: capture-fix-thoughts
description: Capture agent-authored thoughts when making fixes, changes, or implementing features. Documents what was changed and why for future reference.
---

# Capture Fix Thoughts

## The Rule

After completing any fix, change, or feature implementation, **capture a thought** documenting what was done.

## How to Capture

Use `eigen_capture_thought` with the default parameters (omit `as_user` or set to `false`):

```
eigen_capture_thought(
  raw: "Fixed: [brief description of what was changed]. [One sentence explaining why/how it works]."
)
```

This automatically stores the thought as agent-authored with your API key name (`pi.dev`).

## What to Document

- **What was fixed/changed** — the problem or feature
- **Which files were modified** — key file paths
- **Why the fix works** — brief technical explanation

## Examples

### Bug Fix
> "Fixed: notification click handler in service-worker.ts now navigates existing window to the notification URL instead of just focusing it. This ensures mobile push notifications lead to the correct page."

### UI Fix
> "Fixed: Safari bottom menu overlapping plus icon button on mobile. Changed memory-surface-nav.svelte from static bottom-20 to bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] to account for iPhone safe area insets."

### Feature
> "Added: grounding question notification now sends users to /capture?grounding=1 with auto-scroll to the question card."

## When to Apply

- After fixing a bug
- After implementing a feature
- After a significant refactor
- After updating tests that document new behavior

## When NOT to Apply

- Trivial changes (typo fixes, formatting)
- When the user explicitly says not to capture
- During investigation/exploration (only capture after the fix is confirmed)
