# Contributing to FinePrint

TODO: contributor guide.

## Prerequisites

- Node 22 or later
- pnpm (version pinned in `package.json`)
- Xcode with the iOS 26 SDK (for `ios/`)

## Setup

```sh
pnpm install
```

## Repository layout

| Path | Contents |
|---|---|
| `ios/` | SwiftUI app |
| `server/` | Hono API and web report |
| `jurisdictions/` | Rule packs and statute snapshots |
| `eval/` | AI evaluation harness |
| `research/` | User research and personas |
| `docs/` | Project documentation |
| `scripts/` | Maintenance and seeding scripts |
| `e2e/` | End-to-end tests |

## Workflow

See [AGENTS.md](AGENTS.md) for the issue, branch, and pull request workflow.
