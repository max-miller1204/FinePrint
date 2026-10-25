import SwiftUI

/// The AI trace overlay (#39): for each model call behind an answer, the model ID, stage, latency,
/// and tokens. Shown under the answer when the developer toggle is on. It is ordinary content in
/// the reading order, one VoiceOver element per call, so it never blocks navigation.
struct AITraceView: View {
    let steps: [AITraceStep]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("AI Trace", systemImage: "cpu")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                StepRow(step: step)
                    .accessibilityIdentifier("aiTrace.step.\(index)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.tertiarySystemBackground), in: .rect(cornerRadius: 12))
        .accessibilityIdentifier("aiTrace")
    }

    private struct StepRow: View {
        let step: AITraceStep

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: step.model)
                    .font(.footnote.monospaced().weight(.semibold))
                    .textSelection(.enabled)
                Text(details)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }

        private var details: String {
            let latency = Measurement(value: Double(step.ms) / 1_000, unit: UnitDuration.seconds)
                .formatted(.measurement(width: .narrow, numberFormatStyle: .number.precision(.fractionLength(1))))
            let tokens = String(localized: "\(step.inputTokens) in, \(step.outputTokens) out tokens")
            let parts = [step.stage, latency, tokens] + (step.fallback ? [String(localized: "fallback")] : [])
            return parts.joined(separator: " · ")
        }
    }
}

#Preview {
    AITraceView(steps: [
        AITraceStep(stage: "responsibility", model: "gemma-4-26b-a4b-it", ms: 8_420, inputTokens: 3_210, outputTokens: 540, fallback: false),
        AITraceStep(stage: "responsibility_verify", model: "gemma-4-31b-it", ms: 5_130, inputTokens: 1_020, outputTokens: 60, fallback: false),
    ])
    .padding()
}
