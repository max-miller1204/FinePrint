---
name: fineprint-ios-ui
description: >-
  FinePrint's iOS 26 UI rules: where Liquid Glass is allowed, severity tokens,
  VoiceOver patterns, Dynamic Type layouts, copy tone, and the accessibility
  checklist. Use when building, reviewing, or polishing any SwiftUI screen in
  ios/, or when adding a new finding, evidence, or letter view.
---
# FinePrint iOS UI

Source of truth for product decisions: `.plans/fineprint-system-design-spec.md` (Sections 4, 10, 11). This skill turns those decisions into rules for SwiftUI code. For Swift language questions use `write-swift`. For motion critique use `review-animations` and `apple-design` (their code samples are web; the principles apply).

## 1. Liquid Glass: navigation layer only

- Glass goes on **controls that float over content**: tab bar, toolbars, the next-deadline `tabViewBottomAccessory`, floating camera controls, the ghost-overlay opacity slider.
- **Never** put glass behind lease text, statute quotes, findings, or photos. Content sits on `.background` / `.secondarySystemBackground`.
- Prefer system components (`TabView`, `NavigationStack`, `.toolbar`, `.sheet`) that adopt glass automatically before reaching for `.glassEffect()`.
- Group adjacent custom glass controls in one `GlassEffectContainer` so they blend and morph together; do not stack separate glass shapes.
- Do not tint glass with severity colors. Severity lives in content, not chrome.
- Check every custom glass surface with **Reduce Transparency** and **Increase Contrast** on. If text over it drops below 4.5:1, replace it with a solid material.

## 2. Tokens

Define these once in `ios/FinePrint/DesignSystem/` and use them everywhere. Never hard-code colors or symbols for severity.

| Token | Color | SF Symbol | Word (always shown) |
|---|---|---|---|
| `unenforceable` | `.red` | `exclamationmark.octagon.fill` | "Likely unenforceable" |
| `ask` | `.orange` | `exclamationmark.triangle.fill` | "Worth asking about" |
| `info` | `.blue` | `info.circle.fill` | "Good to know" |
| `verified` | `.green` | `checkmark.seal.fill` | "Sealed" / "Verified" |
| `pending` | `.secondary` | `clock.badge` | "Waiting to seal" |

Rule: color + symbol + word, every time. Color alone never carries meaning.

Type: system text styles only (`.body`, `.headline`, ...). Verbatim lease and statute quotes and SHA-256 hashes use `.body.monospaced()` and `.textSelection(.enabled)`.

## 3. VoiceOver

- A finding row is **one** element: `.accessibilityElement(children: .combine)`, label = severity word + title, value = citation, hint = "Opens details".
- Extra details (lease quote, statute quote, confidence) go in `.accessibilityCustomContent`, not in the label.
- Clause explorer exposes a custom rotor named "Findings" that jumps between highlighted clauses.
- Streaming findings: post `AccessibilityNotification.Announcement` for stage changes and each new `unenforceable` finding. Throttle to at most one announcement every 2 seconds.
- Camera: spoken guidance for framing and ghost alignment ("Move left", "Aligned"), plus a haptic tick when aligned. The shutter has a label that includes the checklist item ("Take photo of kitchen walls").
- Damage boxes: each box is an element ("Scuff, minor, AI suggested. Double-tap to confirm, adjust, or remove") with `accessibilityActions` for Confirm, Adjust, Not damage.
- Decorative images and dividers: `.accessibilityHidden(true)`.

## 4. Dynamic Type

- Support up to `.accessibility5`. Test at Default, XXXL, and AX5.
- Rows that are horizontal at default sizes switch to vertical at accessibility sizes: use `ViewThatFits` or check `dynamicTypeSize.isAccessibilitySize`.
- Never truncate legal quotes, letter text, or deadline text. Allow wrapping; use `lineLimit(nil)`.
- Minimum hit target 44x44 pt, including the tiny "Not damage" action on photos.

## 5. Motion

- Springs for sheets, overlays, and finding insertion; interruptible. Stagger newly streamed findings by about 40 ms.
- Under **Reduce Motion**: cross-fade only, no slides, no scale, no parallax.
- Do not animate legal text or numbers that the tenant needs to read (deadline counts tick without animation).

## 6. Keyboard and Voice Control

- Primary actions have `.keyboardShortcut` (Seal: Cmd-Return, Ask: Cmd-K).
- Custom controls are `.focusable()` with visible focus.
- Voice Control names match the visible label exactly (`.accessibilityInputLabels` when the visible label is long).

## 7. Copy tone

- Calm, factual, second person. No exclamation points, no fear words ("illegal!", "scam").
- "Virginia law says..." rather than "Your landlord is breaking the law."
- Always pair a finding with "What you can do."
- Default reading level grade 7 or lower; "Simpler" mode grade 5 or lower.
- Footer on Lease, Repairs, Ask, Letters: "Legal information, not legal advice."
- Never tell the tenant to withhold rent.
- Strings live in `Localizable.xcstrings`; never concatenate translated fragments.

## 8. Review checklist (run before merging a screen)

- [ ] Glass only on navigation/control layer; content on solid backgrounds
- [ ] Severity uses token (color + symbol + word)
- [ ] VoiceOver: every control labeled, rows combined, custom content for details, logical order
- [ ] Dynamic Type AX5: nothing truncated or overlapping
- [ ] Reduce Transparency, Increase Contrast, Reduce Motion, Dark Mode all checked
- [ ] Hit targets at least 44x44 pt
- [ ] Hardware keyboard can reach and trigger every action
- [ ] Empty, loading, error, offline, and worst-case states exist (run `break-ui`)
- [ ] Copy follows tone rules and is localized
