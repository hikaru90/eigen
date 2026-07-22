---
name: git-bisect-debug
description: When something breaks, ask if it was working before, then look at recent commits to find what changed. Don't jump around trying to understand the whole system.
---

# Git Bisect Debug

## The Rule

When something is broken, **don't** immediately start reading every file in the system trying to understand how it works. Instead:

1. **Ask**: "Was this working before?" or "When did this break?"
2. **If yes** → look at recent commits (git log, git diff) to find what changed
3. **Compare** the working state vs broken state to identify the breaking change
4. **Fix** the specific change that broke it

## Why

- Most breakages are caused by a recent change, not by understanding the entire system
- Reading 50 files to understand the architecture is slower than checking 3 recent commits
- The answer is usually in the diff of the last few commits

## Example

Broken: PWA service worker build fails

Wrong approach:

- Read the entire PWA plugin source
- Read the entire SvelteKit build pipeline
- Read the service worker configuration
- Try 10 different fixes

Right approach:

1. "Was this working before?" → "Yes, 3 commits ago"
2. `git log --oneline -5` → see recent commits
3. `git diff HEAD~3..HEAD -- vite.config.ts svelte.config.js` → find what changed
4. Spot the breaking change → fix it

## Anti-Patterns

- ❌ Reading every file related to the error
- ❌ Trying to understand the entire system before fixing
- ❌ Making random changes hoping something works
- ❌ Asking "how does this work?" when you should ask "what changed?"

## When to Apply

- Build failures
- Runtime errors that didn't exist before
- UI regressions
- API changes that broke existing functionality
