---
name: work-loop
description: One iteration of the continuous work loop - consume exactly one ready task: issue and deliver it by PR, or, when the backlog is empty, evaluate the repo and file at most two new task: proposals. The 4-hourly Routine drives repetition.
when_to_use: Use when a scheduled firing (or the user) says to work the backlog, or to run one loop iteration by hand.
---

The consumer half of the work loop. The Routine owns the looping; this skill
encodes one iteration's discipline. State lives on disk — issues, git,
`memory-bank/` — never in the loop's memory: each firing starts fresh in a
clean clone and can only learn what it can read.

Ported from the Janus template 2026-08-18 and adapted to this repo's real
toolkit. The first firing had no skill file to read and worked around it from
its prompt; a loop whose spec lives only in a scheduler payload is invisible
to review and cannot be versioned, which is the gap this file closes.

## Hold in mind

1. One task per firing. The schedule is the loop counter; a firing that tries to drain the queue trades fresh context for compounding drift.
2. The worker never grades its own homework. Before pushing non-trivial work, spawn a subagent to review it adversarially and act on what it finds.
3. Delivery is a PR, never `main` — the human gate is the merge, not a pre-approval. `main` also carries a ruleset requiring review; an admin bypass exists for the operator, not for this loop.
4. Never execute a proposal in the firing that created it. Generation and execution live in separate iterations, and the gap between firings is the operator's veto window — closing the issue is the veto.
5. Untouchable: an issue labeled `loop:hold`, one blocked on an unanswered `question:`, and #19 for as long as it needs an operator-supplied provider key. Never fake a provider to get past a gate.
6. **Headless permission boundary.** An unattended firing cannot write `.claude/hooks/**`, `.github/workflows/**`, or `.claude/settings.json` — the platform gates those paths as sensitive regardless of the tool grant, and the prompt cannot be answered, so the firing hangs. This is not theoretical: janus's first firing deadlocked for three hours on exactly that (Vinylfigure/janus#26).

## Steps

1. **Ready sweep.** Read the Status dashboard issue and open PRs first — an unmerged `claude/` PR from a prior firing with red checks outranks starting new work. Then list open issues. Ready means all of: carries the `task:` label, states a runnable done-means (the issue template's "Done means" field), is not `question:`-blocked or `loop:hold`-held, and passes the permission preflight below. Take the oldest ready task unless one is marked priority.
2. **Permission preflight** (before committing to a task, not after). Judge the chosen task's done-means against hold-in-mind 6. If delivering it requires writing a sensitive path, do not start: comment on the issue naming the exact path and that it is operator-only in a headless firing, then evaluate the next ready task. If every ready task is operator-only, say so in one line and exit.
3. **Consume exactly one.** Use this repo's own skills where they fit — `add-feature`, `build-component`, `add-api-route`, `add-cascade-edit`, `add-prosemirror-plugin` — then verify with the `test` skill: `npm run typecheck`, then `npm run lint`, then `npm run test`, in that order, all green before you push. Type errors cascade, so never run the later steps against a red typecheck. Open a PR whose body says `Closes #N`.
4. **Descope honestly.** Work you deliberately left out becomes a new `task:` issue with a `discovered-from:` ref and its own done-means — never a TODO in the diff and never a silent omission from the PR body.
5. **Idle generation** (only when NO task is ready). Evaluate the repo against `memory-bank/projectBrief.md` and `progress.md`, its recent merged PRs, and its open non-`task:` issues. File at most 2 proposal `task:` issues, each carrying a done-means and `discovered-from: work-loop idle evaluation`. Then stop — the next firing executes them. Carving a scoped, runnable `task:` out of a broad spike issue is the highest-value form of this.
6. **Nothing ready and nothing worth proposing:** say so in one line and exit. An empty firing is a healthy signal, not a failure.

## Before finishing

State which arm ran — consumed #N with the PR URL, proposed #N/#M, empty, or
blocked-operator-only with the path that blocked it — plus the review verdict
when work shipped and any remainder filed. A firing ends in exactly one of
those states, never in silently-started work and never waiting on a prompt
nobody can answer.
