---
name: data-safety
description: Non-negotiable data safety rules. NEVER touch, overwrite, or modify .env files. Do not run scripts that write to .env. Do not execute install.sh against a live project directory. If .env changes are needed, show the user the diff and let them apply it.
---

# Data Safety Rules

## .env — DO NOT TOUCH

**NEVER** read, write, overwrite, modify, or execute any script that modifies `.env` files in this project.

This includes:

- Running `install.sh` (even with `--force`)
- Running `cp .env.example .env`
- Running `set_env_var` or `sed` against `.env`
- Any `git checkout`, `git restore`, or `git stash` that touches `.env`
- Any command that writes to `.env` directly or indirectly

If a change to `.env` is genuinely needed:

1. Show the user the exact diff or new lines
2. Let the user apply it manually
3. Never execute it yourself

**There are no exceptions to this rule.**

## Git commit & push — ASK FIRST

Never `git commit` or `git push` without asking the user first. Always show the diff, wait for confirmation, then commit/push.
