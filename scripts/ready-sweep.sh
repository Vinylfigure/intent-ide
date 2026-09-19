#!/usr/bin/env bash
# ready-sweep.sh — the mechanical half of the work-loop's step-1 "ready" test.
#
# Prints one line per READY task, oldest first: `<number>\t<title>`. Prints
# nothing when no task is ready. Always exits 0 unless the GitHub read itself
# fails (exit 2), so a caller can tell "queue empty" from "queue unread"
# (L-064: an empty queue and an unqueried one must never render alike).
#
# Ready, per .claude/skills/work-loop/SKILL.md step 1 — the parts a shell can
# decide from the record alone:
#   - open issue whose title starts with `task:` (never `intent:`/`goal:`)
#   - not `task: [operator]` / `task: your check` (operator-owed by title)
#   - not labelled `loop:hold` or `question:`, and not blocked on an open
#     `question:` it names in a `Blocked on:` / `blocked-by:` line
#   - carries a done-means (a `done-means`/`Done means` heading or line)
#   - no open pull request already delivering it: none whose head matches
#     `claude/issue-<N>-*`, `claude/<N>-*`, `task-<N>-*`, or whose body
#     says `Closes #<N>`
# The one predicate a shell cannot decide is "inside this environment's tool
# grant" — that stays the model's judgment (and /dispatch's preflight.sh).
#
# Usage: scripts/ready-sweep.sh [owner/repo]      (GH_TOKEN or gh auth)
# Env:   READY_SWEEP_LIMIT (default 200)
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
[ -n "$repo" ] || { echo "ready-sweep: no repo (pass owner/repo)" >&2; exit 2; }
limit="${READY_SWEEP_LIMIT:-200}"

issues=$(gh issue list -R "$repo" --state open --limit "$limit" \
  --json number,title,body,labels 2>/dev/null) || { echo "ready-sweep: issue read failed for $repo" >&2; exit 2; }
prs=$(gh pr list -R "$repo" --state open --limit "$limit" \
  --json number,headRefName,body 2>/dev/null) || { echo "ready-sweep: PR read failed for $repo" >&2; exit 2; }
# Open question: issues, so a "Blocked on: #N" line can be resolved.
open_questions=$(printf '%s' "$issues" | jq -c '[.[] | select(.title | test("^question:")) | .number]')

printf '%s' "$issues" | jq -r --argjson prs "$prs" --argjson oq "$open_questions" '
  def has_done_means: (.body // "") | test("(?i)(^|\\n)[ \\t]*(#+[ \\t]*)?done[- ]means") or test("(?i)\\bdone[- ]means[ \\t]*:");
  def label_names: [.labels[]?.name];
  def blocked_refs: [((.body // "") | scan("(?i)blocked[- ](on|by):[^\\n]*") | scan("#([0-9]+)") | .[0] | tonumber)];
  def in_flight($n):
    any($prs[]; (.headRefName | test("^(claude/issue-\($n)-|claude/\($n)-|task-\($n)-)"))
              or ((.body // "") | test("(?i)closes\\s+#\($n)\\b")));
  [ .[]
    | select(.title | test("^task:"))
    | select(.title | test("^task: *(\\[operator\\]|your check)") | not)
    | select((label_names | index("loop:hold")) == null)
    | select((label_names | index("question:")) == null)
    | select(has_done_means)
    | select((blocked_refs | any(. as $r | $oq | index($r) != null)) | not)
    | select(in_flight(.number) | not)
  ] | sort_by(.number)[] | "\(.number)\t\(.title)"'
