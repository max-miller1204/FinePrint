---
name: max-2-board
description: >-
  Self-paced workflow for the "Max^2" GitHub Projects board: triage inbox,
  create issues with priority, pick what to work on next (with a WIP limit),
  log what got done, sync labels, and upgrade the board. Use
  when the user asks to triage, file an issue, decide what is next, see what
  got done, or upgrade the board.
---
# Max^2 board

Board: https://github.com/users/max-miller1204/projects/19
Linked repos: max-miller1204/FinePrint (primary: max-miller1204/FinePrint)
Setup: **hackathon** preset, **self-paced** pace.
WIP limit: 5 items In Progress. Over the limit, warn the user. Never block or move their work.

All project, field, and option IDs are in [config.json](config.json) (a link to `.github/linear-board.json`). Do not rediscover them. Run every command through the shared CLI, which is also used by the GitHub Actions:

```
export LINEAR_BOARD_CONFIG=.agents/skills/max-2-board/config.json
bash .github/linear-board/board.sh help
```

Run commands from the root of max-miller1204/FinePrint, with `LINEAR_BOARD_CONFIG` set as above. Below, `board` is short for `bash .github/linear-board/board.sh`. Refs look like `owner/repo#12`, `repo#12`, or `#12`. A bare number refers to the primary repo. `board profile` shows what this board has. A command for a feature the board does not have fails with a message that names the upgrade.

## Model

| Linear | Here |
|---|---|
| Workflow state | `Status`: Todo, In Progress, Done |
| Now / Next / Later | Now = In Progress, Next = Todo |
| Priority | `Priority`: Urgent, High, Medium, Low, No priority |
| Type | Label: bug, feature, chore |
| Duplicate | Closed as duplicate (there is no Canceled status) |

The git-sync Action requires the setup on the default branch and a PROJECT_TOKEN secret:

- New issues with no Status land in **Todo**.
- A branch named `12-...` moves #12 to In Progress and assigns the branch creator.
- A merged PR moves it to Done.
- When an issue moves to In Progress and the board is over the WIP limit, git-sync comments on the issue. It does not block anything.

## 1. Triage inbox

1. Run `board triage`. It lists Todo items that have no priority yet (oldest first).
2. For each item, read the issue (`gh issue view N -R repo`). Propose a type, a priority, then ask the user. Decide one item at a time unless the user wants a batch.
3. Apply the decision:
   - Accept: `board set REF priority=High`. Add the type label with `gh issue edit N -R repo --add-label bug` if it is missing.
   - Decline: `board decline REF "reason"`. This closes the issue as not planned.
   - Duplicate: `board duplicate REF ORIGINAL_REF`.
4. End with a summary: how many accepted, declined, and marked duplicate.

## 2. Create an issue, Linear-style

Ask only for the values that are missing. Use the defaults: type from context, priority "No priority". There are no cycles and no due dates.

```
board create --repo REPO --title "..." --body "..." --type bug|feature|chore --priority High \
  [--assignee @me] [--status Todo]
```

Use only the flags for fields the board has (see `board profile`). Status defaults to Todo. Use `--status Todo` for Next.
Report the URL.

## 3. What's next

Run `board next` (or `board next --limit 10`). It shows:

- **Now**: items In Progress, and the WIP count against the limit of 5.
- **Next**: open Todo items, ordered by priority (Urgent first), then by age (oldest first).

Suggest the top item. When the user starts it, run `board set REF status="In Progress"`. If the board is over the WIP limit, the command prints a warning: tell the user and suggest finishing or pausing something first. Do not refuse to start the item.

To see what got done, run `board digest --dry-run`.

## Label sync

Run `board labels-sync`. It creates or updates this board's labels (bug, feature, chore) in every linked repo. To add a label everywhere, add it to `labels` in `.github/linear-board.json` in each repo, then run the sync.

## Upgrade the board

Upgrades only add Status options, fields, views, labels, workflows, and issue forms. They never delete anything (views from the old setup stay). Allowed: preset hackathon -> solo -> full, and pace self-paced -> timeboxed.

1. Ask the user which upgrade they want, and for Timeboxed, the cycle length in days and the start (a date or a weekday).
   For Timeboxed, also ask whether to keep the WIP limit of 5, change it to a new number, or remove it. Timeboxed boards do not need one. The command fails without this answer.
2. Run, for example: `board upgrade --preset solo` or `board upgrade --pace timeboxed --cycle-days 14 --cycle-start monday`. Use `--wip N` for a new WIP limit, `--wip keep` to keep it, or `--wip none` to remove it.
3. It updates `.github/linear-board.json`, the board, the labels, `.github/workflows`, `.github/ISSUE_TEMPLATE`, and this skill. Show `git status`, then ask before you commit and push. Scheduled workflows run only from the default branch.
4. Give the user the manual steps that the command prints (built-in workflow inbox status, settings for the new views, other linked repos).

## Rules

- Ask before you close, decline, or bulk-edit issues.
- Use the CLI for writes. For something the CLI does not cover, use `gh api graphql` with the IDs from config.json.
- Item JSON for custom queries: `board items --status Todo | jq ...`.
