import SwiftUI

/// First launch (spec §4.2): welcome, language, place, and where the tenant is in the rental.
/// No account, no typing for a Virginia renter, and no notification prompt: that comes later,
/// in context, when the first deadline exists.
struct OnboardingView: View {
    enum Step: Int, CaseIterable {
        case welcome, language, place, phase
    }

    /// Called once with the finished draft. The caller saves the rental and shows the tabs.
    let onFinish: (OnboardingDraft) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step = Step.welcome
    @State private var draft = OnboardingDraft()

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                content
                    .padding(.horizontal)
                    .padding(.top, 24)
                    .padding(.bottom, 16)
                    .frame(maxWidth: 560, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .id(step)
                    .transition(.opacity)
            }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
        .background(Color(.systemBackground))
        .sensoryFeedback(.selection, trigger: draft.phase)
        .onChange(of: step) {
            AccessibilityNotification.ScreenChanged().post()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome: WelcomeStep()
        case .language: LanguageStep(selection: $draft.language)
        case .place: PlaceStep(draft: $draft)
        case .phase: PhaseStep(selection: $draft.phase)
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            if step == .phase {
                Button {
                    onFinish(draft)
                } label: {
                    Text("Get started").frame(maxWidth: .infinity)
                }
                .disabled(!draft.canFinish)
                .accessibilityIdentifier("onboarding.finish")
            } else {
                Button {
                    go(to: Step(rawValue: step.rawValue + 1) ?? .phase)
                } label: {
                    Text("Continue").frame(maxWidth: .infinity)
                }
                .disabled(step == .place && draft.place == nil)
                .accessibilityIdentifier("onboarding.continue")
            }
            if step != .welcome {
                Button("Back") {
                    go(to: Step(rawValue: step.rawValue - 1) ?? .welcome)
                }
                .controlSize(.large)
                .accessibilityIdentifier("onboarding.back")
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .padding()
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
    }

    private func go(to next: Step) {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) {
            step = next
        }
    }
}

private struct StepHeader: View {
    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WelcomeStep: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            StepHeader(
                title: "Welcome to FinePrint",
                subtitle: "Check your lease, keep proof of your home's condition, and know your deadlines."
            )
            Label {
                Text("Not a lawyer. Built on Virginia law.")
                    .font(.headline)
            } icon: {
                Image(systemName: "info.circle.fill")
                    .foregroundStyle(.blue)
            }
            .accessibilityIdentifier("onboarding.disclosure")
            Text("No account needed. Your photos stay on your phone.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

private struct LanguageStep: View {
    @Binding var selection: AppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            StepHeader(title: "Choose your language")
            ForEach(AppLanguage.allCases) { language in
                OptionRow(isSelected: selection == language) {
                    selection = language
                } label: {
                    Text(language.nativeName).font(.headline)
                }
                .accessibilityIdentifier("onboarding.language.\(language.rawValue)")
            }
        }
    }
}

private struct PlaceStep: View {
    @Binding var draft: OnboardingDraft
    @State private var query = ""

    private var results: [Locality] { VirginiaLocalities.matching(query) }
    private var typed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            StepHeader(
                title: "Where do you rent?",
                subtitle: "Just the city or county. FinePrint never asks for your street address."
            )
            statePicker
            if draft.isOutsideVirginia {
                outsideVirginia
            } else {
                virginia
            }
        }
    }

    private var statePicker: some View {
        HStack {
            Text("State")
            Spacer()
            Picker("State", selection: $draft.state) {
                ForEach(USState.all) { state in
                    Text(state.name).tag(state)
                }
            }
            .labelsHidden()
            .accessibilityIdentifier("onboarding.state")
        }
    }

    private var outsideVirginia: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label {
                Text("FinePrint's legal checks only cover Virginia. Evidence tools still work.")
            } icon: {
                Image(systemName: "info.circle.fill").foregroundStyle(.blue)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("onboarding.outsideVirginia")
            TextField("City or county", text: $draft.otherCity)
                .textFieldStyle(.roundedBorder)
                .textContentType(.addressCity)
                .submitLabel(.done)
                .accessibilityIdentifier("onboarding.place.city")
        }
    }

    private var virginia: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Search cities and counties", text: $query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("onboarding.place.search")
            if !typed.isEmpty && !results.contains(where: { $0.displayName.caseInsensitiveCompare(typed) == .orderedSame }) {
                let custom = Locality(name: typed, kind: .city)
                OptionRow(isSelected: draft.virginiaPlace == custom) {
                    draft.virginiaPlace = custom
                } label: {
                    Text("Use \"\(typed)\"")
                }
                .accessibilityIdentifier("onboarding.place.custom")
            }
            ForEach(results) { locality in
                OptionRow(isSelected: draft.virginiaPlace == locality) {
                    draft.virginiaPlace = locality
                } label: {
                    Text(locality.displayName)
                }
                .accessibilityIdentifier("onboarding.place.\(locality.id)")
            }
        }
    }
}

private struct PhaseStep: View {
    @Binding var selection: OnboardingPhase?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            StepHeader(
                title: "Where are you in your rental?",
                subtitle: "This sets where FinePrint starts and which deadlines to watch."
            )
            ForEach(OnboardingPhase.allCases) { phase in
                OptionRow(isSelected: selection == phase) {
                    selection = phase
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(phase.title).font(.headline)
                        Text(phase.detail).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("onboarding.phase.\(phase.testID)")
            }
        }
    }
}

/// A full-width choice on a solid background, with a checkmark and a bold outline when chosen, so
/// the selection never rests on color alone.
private struct OptionRow<Label: View>: View {
    let isSelected: Bool
    let action: () -> Void
    @ViewBuilder let label: Label

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                label
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    .accessibilityHidden(true)
            }
            .padding(14)
            .frame(minHeight: 44)
            .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(.tint, lineWidth: isSelected ? 2 : 0)
            }
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#Preview {
    OnboardingView { _ in }
}
