import Foundation

/// The language the tenant picks in onboarding. Only English is localized today; Spanish strings
/// arrive with #45, so choosing Español stores the choice and the app stays in English until then.
nonisolated enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
    case english = "en"
    case spanish = "es"

    var id: String { rawValue }

    /// Each language names itself, so a tenant can find theirs whatever the app shows.
    var nativeName: String {
        switch self {
        case .english: "English"
        case .spanish: "Español"
        }
    }

    static let storedKey = "FinePrint.language"

    /// The first supported language in the device's preference order, else English.
    static func deviceDefault(preferred: [String] = Locale.preferredLanguages) -> AppLanguage {
        for tag in preferred {
            let code = Locale.Language(identifier: tag).languageCode?.identifier
            if let language = AppLanguage(rawValue: code ?? "") { return language }
        }
        return .english
    }

    static func stored(in defaults: UserDefaults = .standard) -> AppLanguage? {
        defaults.string(forKey: storedKey).flatMap(AppLanguage.init(rawValue:))
    }

    func store(in defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.storedKey)
    }
}

/// "Where are you in your rental?" (spec §4.2 step 4): the four answers, the phase each sets, and
/// the tab the tenant lands on.
enum OnboardingPhase: String, CaseIterable, Identifiable {
    case beforeSigning
    case justMovedIn
    case livingThere
    case movingOut

    var id: String { rawValue }

    var rentalPhase: RentalPhase {
        switch self {
        case .beforeSigning: .preSigning
        case .justMovedIn: .moveIn
        case .livingThere: .living
        case .movingOut: .moveOut
        }
    }

    /// Before signing, the lease is what matters; right after move-in and while moving out, the
    /// photos; while living there, repairs.
    var firstTab: AppTab {
        switch self {
        case .beforeSigning: .lease
        case .justMovedIn, .movingOut: .evidence
        case .livingThere: .repairs
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .beforeSigning: "Before signing"
        case .justMovedIn: "Just moved in"
        case .livingThere: "Living there"
        case .movingOut: "Moving out"
        }
    }

    var detail: LocalizedStringResource {
        switch self {
        case .beforeSigning: "Check the lease before you sign it."
        case .justMovedIn: "Photograph the home and watch your move-in deadlines."
        case .livingThere: "Handle repairs and keep your records."
        case .movingOut: "Compare the home to move-in and protect your deposit."
        }
    }

    /// The test id suffix is the server's phase value.
    var testID: String { rentalPhase.rawValue }
}

/// What the tenant has chosen so far. `makeRental` turns it into the local `Rental`.
struct OnboardingDraft: Equatable {
    var language: AppLanguage = .deviceDefault()
    var state: USState = .virginia
    /// The pick from the Virginia list, or a typed Virginia town.
    var virginiaPlace: Locality?
    /// The typed city for a state other than Virginia.
    var otherCity = ""
    var phase: OnboardingPhase?

    var isOutsideVirginia: Bool { state != .virginia }

    /// The city or county to save, or nil until the tenant has chosen or typed one.
    var place: Locality? {
        if isOutsideVirginia {
            let name = otherCity.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty ? nil : Locality(name: name, kind: .city)
        }
        return virginiaPlace
    }

    var canFinish: Bool { place != nil && phase != nil }

    /// A rental for the answers so far, or nil if place or phase is missing. `occupancyDate` is
    /// today for "Just moved in", which starts the move-in deadlines.
    func makeRental(today: CalendarDay = CalendarDay(.now), now: Date = .now) -> Rental? {
        guard let place, let phase else { return nil }
        return Rental(
            name: place.displayName,
            createdAt: now,
            jurisdiction: state.code,
            city: place.kind == .city ? place.name : nil,
            county: place.kind == .county ? place.displayName : nil,
            phase: phase.rentalPhase,
            occupancyDate: phase == .justMovedIn ? today : nil
        )
    }

    /// The default rental for `-FinePrintSkipOnboarding`: Richmond, Virginia, living there.
    static func skipped(now: Date = .now) -> Rental {
        Rental(
            name: VirginiaLocalities.defaultCity.displayName,
            createdAt: now,
            jurisdiction: "VA",
            city: VirginiaLocalities.defaultCity.name,
            phase: .living
        )
    }
}
