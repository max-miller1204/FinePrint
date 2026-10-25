import SwiftUI

// How a responsibility answer reads (spec §4.3 F4). A verdict is not a severity, so it gets no
// severity color: symbol and words carry it, the same for a landlord or a tenant answer.

extension Verdict {
    var title: LocalizedStringResource {
        switch self {
        case .likelyLandlord: "Likely landlord's responsibility"
        case .likelyTenant: "Likely tenant's responsibility"
        case .couldBeEither: "Could be either"
        case .notSure: "Not sure"
        }
    }

    var symbolName: String {
        switch self {
        case .likelyLandlord: "building.2.fill"
        case .likelyTenant: "person.fill"
        case .couldBeEither: "arrow.left.arrow.right"
        case .notSure: "questionmark.circle"
        }
    }
}

extension ResponsibilityCategory {
    var title: LocalizedStringResource {
        switch self {
        case .normalWearAndTear: "Normal wear and tear"
        case .tenantDamage: "Tenant damage"
        case .landlordMaintenance: "Landlord maintenance duty"
        case .preExisting: "Pre-existing (documented at move-in)"
        case .unknown: "Category unclear"
        }
    }
}

extension Confidence {
    /// Shown next to the bars, and read by VoiceOver.
    var title: LocalizedStringResource {
        switch self {
        case .low: "Low confidence"
        case .medium: "Medium confidence"
        case .high: "High confidence"
        }
    }

    /// How many of the three bars are filled: the shape tells the levels apart, not color.
    var barsFilled: Double {
        switch self {
        case .low: 0.33
        case .medium: 0.66
        case .high: 1
        }
    }
}

/// Text plus bars, never color alone (spec §4.3 F4).
struct ConfidenceLabel: View {
    let confidence: Confidence

    var body: some View {
        Label {
            Text(confidence.title)
        } icon: {
            Image(systemName: "cellularbars", variableValue: confidence.barsFilled)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(confidence.title))
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 12) {
        ForEach(Verdict.allCases, id: \.self) { verdict in
            Label { Text(verdict.title) } icon: { Image(systemName: verdict.symbolName) }
        }
        ForEach(Confidence.allCases, id: \.self) { confidence in
            ConfidenceLabel(confidence: confidence)
        }
    }
    .padding()
}
