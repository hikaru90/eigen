---
name: commit-conventions
description: Git commit message conventions for this project. Use when creating commits. Preface commit messages with [fix], [feature], or [chore].
---

# Commit Conventions

All git commit messages in this project must be prefaced with one of:

- `[fix]` — for bug fixes, error corrections, patches
- `[feature]` — for new functionality, capabilities, additions
- `[chore]` — for maintenance, refactoring, dependency updates, config changes

## Format

```
[<type>] <short description>

<optional body>
```

## Examples

```
[feature] add logging to install.sh

[fix] resolve PostgreSQL extension check in install script

[chore] update vitest config
```
