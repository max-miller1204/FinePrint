import Combine
import SwiftUI

extension View {
    /// Shows the next deadline in the tab bar accessory, or no accessory at all when `deadline` is nil.
    ///
    /// The iOS 26.0 SDK only has `tabViewBottomAccessory(content:)`, which always reserves the
    /// glass capsule even for empty content. So the modifier is applied conditionally instead.
    func deadlineAccessory(_ deadline: NextDeadline?, onOpen: @escaping () -> Void) -> some View {
        modifier(DeadlineAccessoryModifier(deadline: deadline, onOpen: onOpen))
    }
}

private struct DeadlineAccessoryModifier: ViewModifier {
    let deadline: NextDeadline?
    let onOpen: () -> Void

    func body(content: Content) -> some View {
        if let deadline {
            content.tabViewBottomAccessory {
                DeadlineAccessoryView(deadline: deadline, onOpen: onOpen)
            }
        } else {
            content
        }
    }
}

/// Glass comes from the system accessory container; this view adds none of its own.
struct DeadlineAccessoryView: View {
    let deadline: NextDeadline
    let onOpen: () -> Void

    /// Refreshed when the app returns to the foreground and when the calendar day changes,
    /// so "3 days left" stays right without a timer. (A `TimelineView` here hides the
    /// button from the accessibility tree on iOS 26.0.)
    @State private var now = Date.now
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let countdown = deadline.countdown(from: now)
        Button(action: onOpen) {
            HStack(spacing: 10) {
                Image(systemName: "calendar.badge.clock")
                    .imageScale(.medium)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        Text(deadline.title)
                            .fontWeight(.semibold)
                        Spacer(minLength: 0)
                        Text(countdown.text)
                            .foregroundStyle(.secondary)
                    }
                    Text(countdown.text)
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .lineLimit(1)
                .monospacedDigit()
            }
            .font(.subheadline)
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        // Not `.plain`: on iOS 26.0 that style drops the button from the accessibility tree
        // inside the accessory, hiding it from VoiceOver and UI tests.
        .buttonStyle(.borderless)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityShowsLargeContentViewer {
            Label {
                Text("\(deadline.title): \(Text(countdown.text))")
            } icon: {
                Image(systemName: "calendar.badge.clock")
            }
        }
        .accessibilityLabel(Text("Next deadline: \(deadline.title), \(Text(countdown.text))"))
        .accessibilityHint(Text("Opens Evidence"))
        .accessibilityIdentifier("deadlineAccessory")
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { now = .now }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged).receive(on: RunLoop.main)) { _ in
            now = .now
        }
    }
}
