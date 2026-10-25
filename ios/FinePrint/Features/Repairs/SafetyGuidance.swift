import SwiftUI

/// What to do right now when triage stops a check (spec §4.3 F5, §7.9): gas, sparks, or flooding,
/// self-harm, or abuse. Safety comes before who pays, so there is no answer here and nothing is
/// saved. The handoff sheet with local resources is #38.
struct SafetyGuidance: View {
    let category: TriageCategory

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label {
                Text(title)
            } icon: {
                Image(systemName: Severity.unenforceable.symbolName)
                    .foregroundStyle(Severity.unenforceable.color)
                    .accessibilityHidden(true)
            }
            .font(.title2.weight(.semibold))
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("issue.safety.title")

            Text(guidance)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("issue.safety.guidance")

            ForEach(calls, id: \.number) { call in
                if let url = URL(string: "tel:\(call.number)") {
                    Link(destination: url) {
                        Label(call.title, systemImage: "phone.fill")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }

            Text("FinePrint didn't save what you wrote. When you're safe, you can come back and check who's responsible for the repair.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
    }

    private var title: LocalizedStringResource {
        switch category {
        case .selfHarm: "You don't have to handle this alone"
        case .domesticViolence: "Your safety comes first"
        default: "Get safe first"
        }
    }

    private var guidance: LocalizedStringResource {
        switch category {
        case .selfHarm:
            "You can talk to someone right now, any time. Call or text 988, the Suicide and Crisis Lifeline."
        case .domesticViolence:
            "If you're in danger, call 911. The National Domestic Violence Hotline is free and private, any time."
        default:
            "If you smell gas, see sparks or smoke, or water is near outlets, leave now and call 911. For gas, call your gas company too, from outside."
        }
    }

    private struct Call {
        var title: LocalizedStringResource
        var number: String
    }

    private var calls: [Call] {
        switch category {
        case .selfHarm: [Call(title: "Call 988", number: "988")]
        case .domesticViolence: [Call(title: "Call 911", number: "911"), Call(title: "Call the Hotline", number: "18007997233")]
        default: [Call(title: "Call 911", number: "911")]
        }
    }
}

#Preview {
    ScrollView {
        VStack {
            SafetyGuidance(category: .immediateDanger)
            SafetyGuidance(category: .selfHarm)
            SafetyGuidance(category: .domesticViolence)
        }
        .padding()
    }
}
