# Issue workflow

- Use the [board skill](.agents/skills/max-2-board/SKILL.md).
- Check ownership before starting. Do not start an issue assigned to someone else.
- Name branches `<issue-number>-<description>`, such as `12-add-document-upload`. Pushing the branch moves the issue to In Progress and assigns you. Creating it locally does not.
- Include `Closes #N` in PRs that complete the issue.
- Numbered branch merges close the issue automatically. For partial work, use an unnumbered branch and `Refs #N`.

# Pull requests

- Use the [PR template](.github/pull_request_template.md) to create PRs.
- Use [e2e](.agents/skills/e2e/SKILL.md) to check new features/fixes are working correctly and that the app as a whole is functioning correctly. Drive each surface through its `verify-<app>` project skill (`.agents/skills/verify-*/`); create a missing one with [create-verification-skill](.agents/skills/create-verification-skill/SKILL.md). This instruction is an explicit invocation.
- Never create a PR until the e2e run passes: the smoke test and the tests for every affected feature exit `0`, and the feature map is updated in the same commit.

# Skills

- Ensure you use the Swift, UI, and design skills:
  - Swift: [write-swift](.agents/skills/write-swift/SKILL.md)
  - UI: [fineprint-ios-ui](.agents/skills/fineprint-ios-ui/SKILL.md), [mobile-native](.agents/skills/mobile-native/SKILL.md) (web report), [break-ui](.agents/skills/break-ui/SKILL.md)
  - Design: [emil-design-eng](.agents/skills/emil-design-eng/SKILL.md), [apple-design](.agents/skills/apple-design/SKILL.md), [review-animations](.agents/skills/review-animations/SKILL.md)
