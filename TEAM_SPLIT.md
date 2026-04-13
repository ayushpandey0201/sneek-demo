# Sneek Demo - 2 Person Team Split (No Merge Conflicts)

This plan splits work so both teammates can move in parallel with minimal risk of merge conflicts.

---

## 1) Team Structure

## Teammate A - Backend Owner

Own these files only:
- `server.js`
- `README.md` (only backend/API sections if needed)

Primary responsibilities:
- verification logic and API behavior
- cross-verification gate behavior and messages
- callback validation checks
- backend response samples for demo

Do not edit:
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `plan.md`

---

## Teammate B - Frontend + Demo Docs Owner

Own these files only:
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `plan.md`
- `TEAM_SPLIT.md`

Primary responsibilities:
- UI polish and clarity of flow
- gate/timeline presentation improvements
- demo script and testing documentation
- evidence checklist and presentation readiness

Do not edit:
- `server.js`

---

## 2) Branch Strategy

Create two branches from `master`:

- `feature/backend-verification` (Teammate A)
- `feature/frontend-demo-polish` (Teammate B)

Commands:

```bash
git checkout master
git pull
git checkout -b feature/backend-verification
```

```bash
git checkout master
git pull
git checkout -b feature/frontend-demo-polish
```

---

## 3) Merge Order (Recommended)

1. Merge backend branch first (`feature/backend-verification`)
2. Rebase frontend branch on latest `master`
3. Merge frontend branch

Reason:
- backend behavior stabilizes first
- frontend final text/UX can adapt to latest API output if needed

---

## 4) Conflict-Avoidance Rules

1. **Single owner per file** (strict).
2. No broad formatting/linting across unrelated files.
3. No accidental lockfile changes unless dependency actually changes.
4. Keep commits small and scoped to owned files.
5. If shared-file edit becomes necessary, coordinate first and do it in one short PR.

---

## 5) Commit Message Convention

Use clear commit prefixes:

- `backend: <message>`
- `frontend: <message>`
- `docs: <message>`

Examples:
- `backend: add stronger replay and callback verification handling`
- `frontend: improve gate labels and status clarity`
- `docs: finalize 8-hour demo runbook and evidence checklist`

---

## 6) PR Checklist Per Teammate

Before opening PR:

- [ ] Only owned files changed
- [ ] App still runs locally
- [ ] No obvious regressions in demo flow
- [ ] Commit messages are clean and scoped
- [ ] PR description includes test steps performed

---

## 7) Daily Sync (5-10 minutes)

At start/end of each work block, sync on:
- current branch status
- blockers
- any required API/UI contract updates
- whether file ownership needs temporary exception

Keep this short and written in one shared note to avoid duplicate work.

---

## 8) Emergency Rule

If both teammates must touch one file urgently:

1. create a temporary coordination branch
2. one person pushes first
3. second person rebases and applies minimal delta
4. merge immediately

Then return to strict ownership split.

