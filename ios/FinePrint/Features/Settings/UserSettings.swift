import Foundation
import Observation

/// How simply explanations are written (spec §4.1). Standard is grade 7 or lower; Simpler is grade 5
/// or lower. Nothing writes at either level yet: the setting is saved for the explanations to read.
nonisolated enum ReadingLevel: String, CaseIterable, Identifiable, Sendable {
    case standard
    case simpler

    var id: String { rawValue }

    var title: LocalizedStringResource {
        switch self {
        case .standard: "Standard"
        case .simpler: "Simpler"
        }
    }
}

/// The choices in Settings (spec §4.1): language, reading level, and the impact counter. They live on
/// this device, in `UserDefaults`; impact consent is also sent to the server.
@Observable
final class UserSettings {
    /// Serializes foreground consent sync with changes in Settings.
    var isSyncingImpact = false

    static let readingLevelKey = "FinePrint.readingLevel"
    static let impactOptInKey = "FinePrint.impactOptIn"
    static let showsAITraceKey = "FinePrint.showsAITrace"

    @ObservationIgnored private let defaults: UserDefaults

    /// Shared with onboarding's language step, which stores under the same key.
    var language: AppLanguage {
        didSet { language.store(in: defaults) }
    }

    var readingLevel: ReadingLevel {
        didSet { defaults.set(readingLevel.rawValue, forKey: Self.readingLevelKey) }
    }

    /// Whether the tenant agreed to be counted in the public impact tally (#57). Off until they turn it on.
    var impactOptIn: Bool {
        didSet { defaults.set(impactOptIn, forKey: Self.impactOptInKey) }
    }

    /// Developer option (#39): show each answer's model calls under it. Off until turned on.
    var showsAITrace: Bool {
        didSet { defaults.set(showsAITrace, forKey: Self.showsAITraceKey) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        language = AppLanguage.stored(in: defaults) ?? .deviceDefault()
        readingLevel = defaults.string(forKey: Self.readingLevelKey).flatMap(ReadingLevel.init(rawValue:)) ?? .standard
        impactOptIn = defaults.bool(forKey: Self.impactOptInKey)
        showsAITrace = defaults.bool(forKey: Self.showsAITraceKey)
    }

    /// Back to a fresh install's choices, and forgets the saved ones. "Delete everything" calls it.
    func reset() {
        language = .deviceDefault()
        readingLevel = .standard
        impactOptIn = false
        showsAITrace = false
        for key in [AppLanguage.storedKey, Self.readingLevelKey, Self.impactOptInKey, Self.showsAITraceKey] {
            defaults.removeObject(forKey: key)
        }
    }
}

extension UserSettings {
    /// Settings for SwiftUI previews, kept apart from the real ones.
    static func preview() -> UserSettings {
        UserSettings(defaults: UserDefaults(suiteName: "FinePrint.preview") ?? .standard)
    }
}
