import SwiftUI

/// The top-level tabs, in tab bar order. Ask is the search-role tab at the trailing edge.
enum AppTab: String, CaseIterable, Hashable {
    case lease
    case evidence
    case repairs
    case letters
    case ask

    var title: LocalizedStringResource {
        switch self {
        case .lease: "Lease"
        case .evidence: "Evidence"
        case .repairs: "Repairs"
        case .letters: "Letters"
        case .ask: "Ask"
        }
    }

    var systemImage: String {
        switch self {
        case .lease: "doc.text"
        case .evidence: "camera.viewfinder"
        case .repairs: "wrench.and.screwdriver"
        case .letters: "envelope"
        case .ask: "bubble.left.and.text.bubble.right"
        }
    }

    /// Stable identifier for UI tests. Do not localize.
    /// iOS 26.0 does not pass `TabContent.accessibilityIdentifier` through to the tab bar
    /// buttons, so tests should find tabs by their accessible name (the title) for now.
    var accessibilityIdentifier: String { "tab.\(rawValue)" }
}
