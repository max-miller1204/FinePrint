<!--
Title: type(scope): subject  (feat, fix, docs, refactor, test, chore, perf; imperative, no final period)
Skip preambles. Keep prose brief. Delete these comments before submitting.
-->

## Summary

<!--
Pick the smallest view that makes the key point clear: pseudocode, a call tree,
a component tree, a Mermaid diagram, or a diff-sketch of the shape that changed.
-->

<diagram, diff-sketch, or tree>

Closes #<issue>  <!-- or "Refs #N" for partial work -->

## Evidence

<!--
Visual change: embed captured before/after screenshots from the running app
(same device, data, and state). Use a short recording for motion. Local file
paths are not evidence; use attachment URLs reviewers can open.
Other changes: replace the table with test output, command output, or
measurements (before -> after, with units). Report only checks you ran.
Include the e2e result (must pass).
-->

| Before | After |
| --- | --- |
| ![Before: <screen and state>](<accessible image URL>) | ![After: <same screen and state>](<accessible image URL>) |

<short caption: action, visible result, and capture conditions>

**e2e:** PASS <!-- command run, tests and targets covered, exit code, link to report or trace -->

## Merge Danger

<!--
Two-way door: cheap to roll back. One-way door: hard to reverse
(destructive actions, data migrations, public contract changes).
Blast radius: everything this could affect (layout, consumers, mobile, data).
-->

**Door:** <one-way or two-way>

<optional: description>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>

<!--
Stacked PR only: uncomment and link the parent and child PRs.
## Stack
-->
