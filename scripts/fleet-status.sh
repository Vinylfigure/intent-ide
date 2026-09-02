#!/usr/bin/env bash
# fleet-status.sh — fleet health sweep + "Status dashboard" issue regenerator.
#
# Run by .github/workflows/fleet-status.yml on a cron (and by hand via
# workflow_dispatch or locally). Requires `gh` authenticated via GH_TOKEN and
# `jq`. Repo is taken from $GITHUB_REPOSITORY, falling back to `gh repo view`.
#
# What it does, in order:
#   (a) ensures the label vocabulary exists (idempotent, --force)
#   (b) aging ladder: open `question:` issues and open PRs from claude/*
#       branches get `aging` after >3 days without update and `overdue` after
#       >7 days. Items are NEVER closed. Both labels are removed when the repo
#       owner is the latest commenter (the operator has responded).
#   (c) L-047 detector: a remote claude/* branch whose head commit is >24h old
#       with no open PR is abandoned work-in-flight — a red finding.
#   (d) regenerates the single "Status dashboard" issue (label `dashboard`),
#       REWRITING its body in place (never appending, never opening a second
#       dashboard issue).
#   (e) exits non-zero iff there are red findings, so the workflow run goes
#       red exactly when the fleet needs operator attention.
#
# Flags:
#   --dry-run   print the dashboard body to stdout and perform NO mutations
#               (no label creates/edits, no issue create/edit). Read-only gh
#               calls still happen, so it can be tested with a stubbed `gh`.

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "fleet-status: gh not found" >&2; exit 2; }
command -v jq >/dev/null || { echo "fleet-status: jq not found" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOOPS_FILE="$ROOT/.github/loops.yaml"

REPO="${GITHUB_REPOSITORY:-}"
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
OWNER="${REPO%%/*}"
# The L-047 detector compares every branch against this, so it must be the
# repo's REAL default — DryDock's is `Main`, not `main`, and guessing would
# make every branch there look stranded.
DEFAULT_BRANCH="${GITHUB_DEFAULT_BRANCH:-}"
if [[ -z "$DEFAULT_BRANCH" ]]; then
  DEFAULT_BRANCH="$(gh api "repos/$REPO" --jq .default_branch 2>/dev/null || true)"
fi
[[ -n "$DEFAULT_BRANCH" ]] || DEFAULT_BRANCH=main
NOW_EPOCH="$(date -u +%s)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

AGING_DAYS=3
OVERDUE_DAYS=7
STALE_BRANCH_HOURS=24
DASHBOARD_TITLE="Status dashboard"

log() { echo "fleet-status: $*" >&2; }

# mutate <gh args...> — run a mutating gh call, or log it in dry-run mode.
mutate() {
  if $DRY_RUN; then
    log "[dry-run] would run: gh $*"
  else
    gh "$@"
  fi
}

# age helpers ---------------------------------------------------------------
epoch_of() { date -u -d "$1" +%s; }
age_days() { echo $(( (NOW_EPOCH - $(epoch_of "$1")) / 86400 )); }
age_hours() { echo $(( (NOW_EPOCH - $(epoch_of "$1")) / 3600 )); }

# ---------------------------------------------------------------------------
# (a) Label vocabulary — idempotent.
# ---------------------------------------------------------------------------
ensure_labels() {
  local spec name color desc
  local specs=(
    "task:|0e8a16|Ready work item with a runnable done-means check"
    "question:|d93f0b|Blocked on an operator answer"
    "loop:hold|5319e7|Operator hold: automation loops must skip this item"
    "aging|fbca04|No update in >${AGING_DAYS} days"
    "overdue|b60205|No update in >${OVERDUE_DAYS} days — needs operator attention"
    "dashboard|1d76db|The regenerated-in-place Status dashboard issue"
  )
  for spec in "${specs[@]}"; do
    IFS='|' read -r name color desc <<<"$spec"
    mutate label create "$name" --force --color "$color" --description "$desc"
  done
}

# ---------------------------------------------------------------------------
# Data collection (read-only).
# ---------------------------------------------------------------------------
fetch_data() {
  PRS_JSON="$(gh pr list --state open --limit 100 \
    --json number,title,headRefName,createdAt,updatedAt,labels,statusCheckRollup)"
  QUESTIONS_JSON="$(gh issue list --state open --label "question:" --limit 100 \
    --json number,title,createdAt,updatedAt,labels)"
  TASKS_JSON="$(gh issue list --state open --label "task:" --limit 100 \
    --json number,title,createdAt)"
  BRANCHES_TSV="$(gh api "repos/$REPO/branches?per_page=100" \
    --jq '.[] | [.name, .commit.sha] | @tsv')"
}

latest_commenter() { # <issue-or-pr number>
  gh api "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq 'last.user.login // empty' 2>/dev/null || true
}

has_label() { # <labels-json-array> <label-name>
  jq -e --arg l "$2" 'any(.[]; .name == $l)' >/dev/null 2>&1 <<<"$1"
}

add_label()    { mutate api -X POST   "repos/$REPO/issues/$1/labels" -f "labels[]=$2"; }
remove_label() { mutate api -X DELETE "repos/$REPO/issues/$1/labels/$2"; }

# ---------------------------------------------------------------------------
# (b) Aging ladder — never closes anything; labels only.
# ---------------------------------------------------------------------------
apply_aging_ladder() { # <number> <updatedAt> <labels-json>
  local num="$1" updated="$2" labels="$3" days commenter
  days="$(age_days "$updated")"
  commenter="$(latest_commenter "$num")"

  if [[ -n "$commenter" && "$commenter" == "$OWNER" ]]; then
    # Operator has responded: clear the ladder.
    has_label "$labels" "aging"   && remove_label "$num" "aging"
    has_label "$labels" "overdue" && remove_label "$num" "overdue"
    return 0
  fi
  if (( days > AGING_DAYS )); then
    has_label "$labels" "aging" || add_label "$num" "aging"
  fi
  if (( days > OVERDUE_DAYS )); then
    has_label "$labels" "overdue" || add_label "$num" "overdue"
  fi
}

run_aging_ladder() {
  local row num updated labels
  # Open question: issues.
  while IFS=$'\t' read -r num updated; do
    [[ -z "$num" ]] && continue
    labels="$(jq -c --argjson n "$num" '.[] | select(.number == $n) | .labels' <<<"$QUESTIONS_JSON")"
    apply_aging_ladder "$num" "$updated" "$labels"
  done < <(jq -r '.[] | [.number, .updatedAt] | @tsv' <<<"$QUESTIONS_JSON")

  # Open PRs from claude/* branches.
  while IFS=$'\t' read -r num updated; do
    [[ -z "$num" ]] && continue
    labels="$(jq -c --argjson n "$num" '.[] | select(.number == $n) | .labels' <<<"$PRS_JSON")"
    apply_aging_ladder "$num" "$updated" "$labels"
  done < <(jq -r '.[] | select(.headRefName | startswith("claude/"))
                  | [.number, .updatedAt] | @tsv' <<<"$PRS_JSON")
}

# ---------------------------------------------------------------------------
# (c) L-047 detector: claude/* branches, head commit >24h old, no open PR.
# ---------------------------------------------------------------------------
RED_FINDINGS=()
MERGED_BRANCHES=()

# Two independent proofs that a branch's work has landed. BOTH are needed.
#
#   merged PR  — the head of a MERGED pull request. Under squash-merge the
#                branch tip is NOT an ancestor of the default branch, so these
#                read ahead=1..4 forever: content landed, commits did not.
#   ahead == 0 — the tip IS an ancestor of the default branch (merge-commit or
#                rebase). Catches branches merged without a PR at all.
#
# Anything else carrying commits of its own is genuinely unshipped work.
# Flagging a delivered branch red rendered "already delivered" and "silently
# stranded" as the same colour (L-064), which trained the operator to stop
# reading the detector — so the branches that WERE stranded went unread with
# them. `unknown` (API unreachable) stays red: fail closed, never hide a
# possible stranding behind a failed lookup.
detect_stale_branches() {
  local pr_heads merged_heads branch sha head_date hours ahead
  pr_heads="$(jq -r '.[].headRefName' <<<"$PRS_JSON")"
  merged_heads="$(gh pr list -R "$REPO" --state merged --limit 500 --json headRefName \
    --jq '.[].headRefName' 2>/dev/null || true)"
  while IFS=$'\t' read -r branch sha; do
    [[ -z "$branch" ]] && continue
    [[ "$branch" == claude/* ]] || continue
    grep -qxF "$branch" <<<"$pr_heads" && continue
    head_date="$(gh api "repos/$REPO/commits/$sha" --jq .commit.committer.date)"
    hours="$(age_hours "$head_date")"
    (( hours > STALE_BRANCH_HOURS )) || continue
    if grep -qxF "$branch" <<<"$merged_heads"; then
      MERGED_BRANCHES+=("\`$branch\` — its PR merged, safe to delete")
      continue
    fi
    ahead="$(gh api "repos/$REPO/compare/$DEFAULT_BRANCH...$branch" \
      --jq 'if type == "object" then (.ahead_by // 0) else "unknown" end' 2>/dev/null || echo unknown)"
    [[ -n "$ahead" ]] || ahead=unknown
    if [[ "$ahead" == "0" ]]; then
      MERGED_BRANCHES+=("\`$branch\` — already in \`$DEFAULT_BRANCH\`, safe to delete")
    elif [[ "$ahead" == "unknown" ]]; then
      RED_FINDINGS+=("L-047: remote branch \`$branch\` head commit is ${hours}h old with no open PR, and its ahead-count could not be read — treat as stranded until proven otherwise.")
    else
      RED_FINDINGS+=("L-047: remote branch \`$branch\` head commit is ${hours}h old, has no merged PR, and carries **${ahead} commit(s) not in \`$DEFAULT_BRANCH\`** — work-in-flight is going stale (open a PR or delete the branch).")
    fi
  done <<<"$BRANCHES_TSV"
}

# ---------------------------------------------------------------------------
# (d) Dashboard body.
# ---------------------------------------------------------------------------
pr_checks_summary() { # <statusCheckRollup json>
  jq -r '
    if (. == null) or (length == 0) then "no checks"
    else
      ( [.[] | (.conclusion // .state // "")] ) as $c
      | ($c | length) as $total
      | ($c | map(select(. == "SUCCESS" or . == "success" or . == "NEUTRAL" or . == "SKIPPED")) | length) as $ok
      | ($c | map(select(. == "FAILURE" or . == "failure" or . == "ERROR" or . == "TIMED_OUT" or . == "CANCELLED" or . == "ACTION_REQUIRED")) | length) as $bad
      | if $bad > 0 then "\($bad) failing (\($ok)/\($total) green)"
        elif $ok == $total then "\($ok)/\($total) green"
        else "pending (\($ok)/\($total) green)"
        end
    end' <<<"$1"
}

build_loops_section() {
  if [[ ! -f "$LOOPS_FILE" ]]; then
    echo "_No \`.github/loops.yaml\` found — expected automations are undeclared._"
    return 0
  fi
  awk '
    function flush() {
      if (name == "") return
      what = (skill != "") ? "skill " skill : "workflow " workflow
      state = (enabled == "true") ? "enabled" : "declared, not armed"
      printf "- **%s** — `%s` via %s (%s) — **%s**", name, schedule, driver, what, state
      if (notes != "") printf " — %s", notes
      printf "\n"
      name = schedule = driver = skill = workflow = enabled = notes = ""
    }
    function val(   s) { s = $0; sub(/^[^:]*:[[:space:]]*/, "", s); gsub(/^"|"$/, "", s); return s }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*-[[:space:]]*name:/    { flush(); name = val() ; next }
    /^[[:space:]]*schedule:/ { schedule = val(); next }
    /^[[:space:]]*driver:/   { driver = val();   next }
    /^[[:space:]]*skill:/    { skill = val();    next }
    /^[[:space:]]*workflow:/ { workflow = val(); next }
    /^[[:space:]]*enabled:/  { enabled = val();  next }
    /^[[:space:]]*notes:/    { notes = val();    next }
    END { flush() }
  ' "$LOOPS_FILE"
}

build_body() {
  local body="" row num title created updated head checks days labels

  # -- Open PRs -------------------------------------------------------------
  body+="## Open PRs"$'\n\n'
  if [[ "$(jq 'length' <<<"$PRS_JSON")" -eq 0 ]]; then
    body+="_None._"$'\n'
  else
    body+="| PR | Title | Age | Checks |"$'\n'
    body+="| --- | --- | --- | --- |"$'\n'
    while IFS=$'\t' read -r num title created; do
      [[ -z "$num" ]] && continue
      checks="$(pr_checks_summary "$(jq -c --argjson n "$num" \
        '.[] | select(.number == $n) | .statusCheckRollup' <<<"$PRS_JSON")")"
      body+="| #$num | $title | $(age_days "$created")d | $checks |"$'\n'
    done < <(jq -r '.[] | [.number, .title, .createdAt] | @tsv' <<<"$PRS_JSON")
  fi
  body+=$'\n'

  # -- Blocked on operator --------------------------------------------------
  body+="## Blocked on operator"$'\n\n'
  local blocked=""
  while IFS=$'\t' read -r num title updated; do
    [[ -z "$num" ]] && continue
    blocked+="- \`question:\` #$num — $title (last update $(age_days "$updated")d ago)"$'\n'
  done < <(jq -r '.[] | [.number, .title, .updatedAt] | @tsv' <<<"$QUESTIONS_JSON")
  while IFS=$'\t' read -r num title updated; do
    [[ -z "$num" ]] && continue
    blocked+="- \`overdue\` PR #$num — $title (last update $(age_days "$updated")d ago)"$'\n'
  done < <(jq -r '.[] | select(.labels | any(.name == "overdue"))
                  | [.number, .title, .updatedAt] | @tsv' <<<"$PRS_JSON")
  if [[ -n "$blocked" ]]; then body+="$blocked"; else body+="_Nothing blocked._"$'\n'; fi
  body+=$'\n'

  # -- Backlog --------------------------------------------------------------
  body+="## Backlog"$'\n\n'
  local task_count oldest
  task_count="$(jq 'length' <<<"$TASKS_JSON")"
  if [[ "$task_count" -eq 0 ]]; then
    body+="_No open \`task:\` issues._"$'\n'
  else
    oldest="$(jq -r 'sort_by(.createdAt) | first | "#\(.number) — \(.title) (\(.createdAt))"' <<<"$TASKS_JSON")"
    body+="Open \`task:\` issues: **$task_count**. Oldest: $oldest."$'\n'
  fi
  body+=$'\n'"> Note: #19 is blocked on a live provider key — an operator must supply it before that task can move."$'\n\n'

  # -- Loops ----------------------------------------------------------------
  body+="## Loops"$'\n\n'
  body+="$(build_loops_section)"$'\n\n'

  # -- Red findings ---------------------------------------------------------
  body+="## Red findings"$'\n\n'
  if (( ${#RED_FINDINGS[@]} == 0 )); then
    body+="_None._"$'\n'
  else
    local f
    for f in "${RED_FINDINGS[@]}"; do
      body+="- :red_circle: $f"$'\n'
    done
  fi
  body+=$'\n'

  # -- Merged branches, not yet deleted --------------------------------------
  # Housekeeping, deliberately NOT a red finding: the work is already in the
  # default branch, so nothing is at risk and nothing should fail a check.
  body+="## Merged branches, not yet deleted"$'\n\n'
  if (( ${#MERGED_BRANCHES[@]} == 0 )); then
    body+="_None._"$'\n'
  else
    body+="Housekeeping only — the work is already in \`$DEFAULT_BRANCH\`."$'\n\n'
    local m
    for m in "${MERGED_BRANCHES[@]}"; do
      body+="- $m"$'\n'
    done
  fi
  body+=$'\n'

  # -- Footer ---------------------------------------------------------------
  body+="_Last updated: ${NOW_ISO}. This issue is regenerated in place by \`scripts/fleet-status.sh\` — the body is rewritten on every run; do not edit it by hand (comments are fine and are how the operator responds)._"$'\n\n'
  body+="---"$'\n'
  body+="_Generated by [Claude Code](https://claude.ai/code)_"$'\n'

  printf '%s' "$body"
}

publish_dashboard() { # <body>
  local body="$1" num
  if $DRY_RUN; then
    printf '%s\n' "$body"
    log "[dry-run] dashboard body printed above; no issue was created or edited."
    return 0
  fi
  local body_file
  body_file="$(mktemp)"
  printf '%s' "$body" > "$body_file"
  num="$(gh issue list --state open --label dashboard --limit 10 --json number,title \
    --jq "[.[] | select(.title == \"$DASHBOARD_TITLE\")] | first.number // empty")"
  if [[ -n "$num" ]]; then
    gh issue edit "$num" --body-file "$body_file"
    log "rewrote dashboard issue #$num in place."
  else
    gh issue create --title "$DASHBOARD_TITLE" --label dashboard --body-file "$body_file"
    log "created dashboard issue."
  fi
  rm -f "$body_file"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "repo=$REPO owner=$OWNER dry_run=$DRY_RUN"
  ensure_labels
  fetch_data
  run_aging_ladder
  detect_stale_branches
  publish_dashboard "$(build_body)"

  # (e) go red iff there are red findings.
  if (( ${#RED_FINDINGS[@]} > 0 )); then
    log "${#RED_FINDINGS[@]} red finding(s) — exiting non-zero."
    exit 1
  fi
  log "no red findings."
}

main
