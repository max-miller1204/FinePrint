import Foundation
import SwiftData

/// Where the tenant is in the tenancy. Raw values match the server's `phase` (spec §6.1).
nonisolated enum RentalPhase: String, Codable, CaseIterable, Sendable {
    case preSigning = "pre_signing"
    case moveIn = "move_in"
    case living
    case moveOut = "move_out"
    case ended
}

/// A calendar date with no time or time zone, such as an occupancy date. Sent to the server as
/// `YYYY-MM-DD`. Deadlines count in whole calendar days from one of these.
nonisolated struct CalendarDay: Codable, Hashable, Comparable, Sendable {
    var year: Int
    var month: Int
    var day: Int

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// The day `date` falls on in `calendar`'s time zone.
    init(_ date: Date, calendar: Calendar = .current) {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1)
    }

    /// Parses `YYYY-MM-DD`.
    init?(isoString: String) {
        let parts = isoString.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]), (1...31).contains(parts[2]) else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    var isoString: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Midnight at the start of this day in `calendar`'s time zone.
    func startOfDay(in calendar: Calendar = .current) -> Date? {
        calendar.date(from: DateComponents(year: year, month: month, day: day))
    }

    static func < (lhs: CalendarDay, rhs: CalendarDay) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }
}

/// A tenancy. Every lease, photo, letter, and deadline will belong to one rental (spec §4.1).
@Model
final class Rental {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    /// The server's `rentals/{rentalId}`, once `POST /v1/rentals` has answered.
    var serverID: String?
    /// A US state code. Only Virginia has legal checks (spec §4.2).
    var jurisdiction: String = "VA"
    /// City and county only, never a street address (spec §6.3).
    var city: String?
    var county: String?
    var phase: RentalPhase = RentalPhase.preSigning
    var occupancyDate: CalendarDay?
    var tenancyEndDate: CalendarDay?

    init(
        id: UUID = UUID(),
        name: String,
        createdAt: Date = .now,
        serverID: String? = nil,
        jurisdiction: String = "VA",
        city: String? = nil,
        county: String? = nil,
        phase: RentalPhase = .preSigning,
        occupancyDate: CalendarDay? = nil,
        tenancyEndDate: CalendarDay? = nil
    ) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.serverID = serverID
        self.jurisdiction = jurisdiction
        self.city = city
        self.county = county
        self.phase = phase
        self.occupancyDate = occupancyDate
        self.tenancyEndDate = tenancyEndDate
    }

    var isInVirginia: Bool { jurisdiction == "VA" }
}
