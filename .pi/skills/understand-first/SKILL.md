---
name: understand-first
description: Diagnose and understand the full picture before proposing code changes or solutions. Prevents premature fixes and ensures root cause is identified.
---

# Understand First

## The Rule

**Before proposing any code change, solution, or answer, you MUST fully understand the issue.**

This means:

1. **Read the relevant code** - Don't guess. Read the actual files, functions, and data flows involved.
2. **Trace the data** - Follow data from input to output. Understand where it comes from, how it transforms, and where it goes.
3. **Check the schema** - Look at database schemas, API contracts, and type definitions. Don't assume field names or types.
4. **Verify assumptions** - If you think something works a certain way, verify it by reading the implementation.
5. **Ask clarifying questions** - If the issue is ambiguous, ask the user for more details before diving into code.

## Anti-Patterns to Avoid

- ❌ **Proposing fixes without reading the code** - You might fix the wrong thing
- ❌ **Assuming data structures** - Always check the actual schema/types
- ❌ **Making multiple small edits** - Understand the full picture first, then make surgical changes
- ❌ **Guessing at root causes** - Trace the actual flow to find the real problem
- ❌ **Skipping the debug step** - Check console logs, network requests, and database state

## Example Workflow

1. User reports: "The model fields are empty"
2. ✅ **First**: Read the load function to see what data is returned
3. ✅ **Then**: Check the database schema to see what fields exist
4. ✅ **Then**: Check if there's data in the database
5. ✅ **Finally**: Propose a fix based on actual findings

## When to Apply

- When debugging issues
- When implementing new features
- When the user reports something is broken
- When making changes to data flows
- When modifying API endpoints or database queries
