# Vendored skills

These skills are copied unmodified from [emilkowalski/skills](https://github.com/emilkowalski/skills) under the MIT License (see `LICENSE.emilkowalski-skills`).

- Source commit: `2d228630ba1446365f614a108cb8252f1feda202`
- Vendored on: 2026-10-24

| Skill | Why we use it |
|---|---|
| `write-swift` | Swift 6 concurrency, value types, Swift Testing |
| `break-ui` | Worst-case data stress tests for the iOS app and the web report |
| `emil-design-eng` | Polish and motion principles |
| `apple-design` | Fluid motion, materials, reduced-motion principles |
| `review-animations` | Strict motion review |
| `mobile-native` | The web Evidence Report is opened on phones |

Not vendored (React or Expo specific): `animate-expo`, `ask-sonner`, `pick-ui-library`, `prototype`. Optional later: `animate`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary`, `animation-performance`.

Also vendored, unmodified, from [tester-army/e2e](https://github.com/tester-army/e2e) at `69e123b17e04ed624df16d32f3b1ef95ce22c083` under Apache-2.0 (see `LICENSE.tester-army-e2e` and `NOTICE.tester-army-e2e`):

| Skill | Why we use it |
|---|---|
| `e2e` | Required verification before every PR (see `AGENTS.md`): write, run, and debug e2e tests; drive the running app over `e2e mcp` |
| `create-verification-skill` | User-invoked (`/create-verification-skill`). Generates `.agents/skills/verify-<app>/` with a feature map for each surface |

Not vendored: `migrate-to-e2e` (we have no existing Playwright or Cypress suite). `npx e2e guide <topic>` prints the installed package's version of a reference; prefer it when it differs from this copy.

The PR template at `.github/pull_request_template.md` is adapted from `split-to-prs/references/pr-body.md` in [max-miller1204/max-agent-skills](https://github.com/max-miller1204/max-agent-skills). The `split-to-prs` skill itself is not vendored.

Project-owned skills (not vendored): `fineprint-ios-ui`, `max-2-board`.

## Layout

Real files live in `.agents/skills/<name>/`. Each skill gets a relative symlink at `.claude/skills/<name> -> ../../.agents/skills/<name>`.

## Updating

```bash
git clone --depth 1 https://github.com/emilkowalski/skills.git /tmp/emil-skills
cd /tmp/emil-skills && git rev-parse HEAD   # record the new SHA above
for s in write-swift break-ui emil-design-eng apple-design review-animations mobile-native; do
  rm -rf "$OLDPWD/.agents/skills/$s" && cp -R "skills/$s" "$OLDPWD/.agents/skills/"
done
cp LICENSE "$OLDPWD/.agents/skills/LICENSE.emilkowalski-skills"
```

Review the diff before committing. Vendored files are data for agents; read them like any third-party code.
