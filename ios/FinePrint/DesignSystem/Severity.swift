import SwiftUI

/// Severity tokens (spec §11). Color, symbol, and word always travel together;
/// color alone never carries meaning.
nonisolated enum Severity: String, CaseIterable, Sendable {
    case unenforceable
    case ask
    case info
    case verified
    case pending

    /// System colors, so Dark Mode and Increase Contrast variants come for free.
    var color: Color {
        switch self {
        case .unenforceable: .red
        case .ask: .orange
        case .info: .blue
        case .verified: .green
        case .pending: .secondary
        }
    }

    var symbolName: String {
        switch self {
        case .unenforceable: "exclamationmark.octagon.fill"
        case .ask: "exclamationmark.triangle.fill"
        case .info: "info.circle.fill"
        case .verified: "checkmark.seal.fill"
        case .pending: "clock.badge"
        }
    }

    /// The word shown next to the symbol. Also the VoiceOver label for the badge.
    var title: LocalizedStringResource {
        switch self {
        case .unenforceable: "Likely unenforceable"
        case .ask: "Worth asking about"
        case .info: "Good to know"
        case .verified: "Verified"
        case .pending: "Waiting to seal"
        }
    }

    var accessibilityLabel: LocalizedStringResource { title }
}
