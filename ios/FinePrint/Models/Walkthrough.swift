import Foundation
import SwiftData

/// The rooms tenants can pick in one tap (spec §4.3 F2). A custom room is any other name.
nonisolated enum RoomPreset: String, Codable, CaseIterable, Identifiable, Sendable {
    case kitchen
    case bathroom
    case bedroom
    case livingRoom = "living_room"
    case hallway
    case exterior

    var id: String { rawValue }

    /// Already localized, because it is stored as the room's name and sent with each photo.
    var title: String {
        switch self {
        case .kitchen: String(localized: "Kitchen")
        case .bathroom: String(localized: "Bathroom")
        case .bedroom: String(localized: "Bedroom")
        case .livingRoom: String(localized: "Living room")
        case .hallway: String(localized: "Hallway")
        case .exterior: String(localized: "Exterior")
        }
    }

    var systemImage: String {
        switch self {
        case .kitchen: "refrigerator"
        case .bathroom: "bathtub"
        case .bedroom: "bed.double"
        case .livingRoom: "sofa"
        case .hallway: "door.left.hand.open"
        case .exterior: "house"
        }
    }

    /// What to photograph here: walls, floor, ceiling, windows, doors, outlets and switches,
    /// fixtures, and appliances, by room (spec §4.3 F2).
    var checklist: [String] {
        switch self {
        case .kitchen: ChecklistItem.names(.walls, .floor, .ceiling, .windows, .doors, .outlets, .fixtures, .appliances)
        case .bathroom, .bedroom, .livingRoom: ChecklistItem.names(.walls, .floor, .ceiling, .windows, .doors, .outlets, .fixtures)
        case .hallway: ChecklistItem.names(.walls, .floor, .ceiling, .doors, .outlets, .fixtures)
        case .exterior: ChecklistItem.names(.walls, .windows, .doors, .fixtures)
        }
    }
}

/// One thing to check in a room, such as "Walls".
nonisolated struct ChecklistItem: Codable, Hashable, Identifiable, Sendable {
    enum Outcome: String, Codable, Sendable {
        /// Not looked at yet.
        case open
        /// At least one photo was kept.
        case photographed
        /// The tenant looked and found nothing wrong. No photo; this is the tenant's word, kept on the device.
        case noDamage
    }

    /// The standard checks, in the order the checklist lists them.
    enum Standard {
        case walls, floor, ceiling, windows, doors, outlets, fixtures, appliances

        var title: String {
            switch self {
            case .walls: String(localized: "Walls")
            case .floor: String(localized: "Floor")
            case .ceiling: String(localized: "Ceiling")
            case .windows: String(localized: "Windows")
            case .doors: String(localized: "Doors")
            case .outlets: String(localized: "Outlets and switches")
            case .fixtures: String(localized: "Fixtures")
            case .appliances: String(localized: "Appliances")
            }
        }
    }

    static func names(_ standard: Standard...) -> [String] { standard.map(\.title) }

    var id: UUID
    var name: String
    var outcome: Outcome = .open
    /// The capture IDs of the photos kept for this item, oldest first.
    var photoIDs: [UUID] = []

    init(id: UUID = UUID(), name: String, outcome: Outcome = .open, photoIDs: [UUID] = []) {
        self.id = id
        self.name = name
        self.outcome = outcome
        self.photoIDs = photoIDs
    }

    var isDone: Bool { outcome != .open }
}

/// One room to walk through and its checklist.
nonisolated struct WalkthroughRoom: Codable, Hashable, Identifiable, Sendable {
    var id: UUID
    var name: String
    /// Nil for a room the tenant named.
    var preset: RoomPreset?
    var items: [ChecklistItem]

    init(id: UUID = UUID(), name: String, preset: RoomPreset? = nil, items: [ChecklistItem]? = nil) {
        self.id = id
        self.name = name
        self.preset = preset
        self.items = items ?? (preset?.checklist ?? Self.customChecklist).map { ChecklistItem(name: $0) }
    }

    init(_ preset: RoomPreset) {
        self.init(name: preset.title, preset: preset)
    }

    /// A room the tenant named gets the common checks.
    static var customChecklist: [String] {
        ChecklistItem.names(.walls, .floor, .ceiling, .windows, .doors, .outlets, .fixtures)
    }

    var doneCount: Int { items.count { $0.isDone } }
    var isComplete: Bool { !items.isEmpty && doneCount == items.count }
}

/// Room names must be short enough to read in the list and on a photo's record.
nonisolated enum RoomName {
    static let maxLength = 60

    /// The name trimmed and cut to `maxLength`, or nil when nothing is left.
    static func cleaned(_ text: String) -> String? {
        let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLength))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func matches(_ lhs: String, _ rhs: String) -> Bool {
        lhs.compare(rhs, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
}

/// A guided room-by-room capture session for a rental (spec §4.3 F2). It ends when the tenant seals
/// the move-in report, which signs the photos and starts the landlord's report clock.
@Model
final class Walkthrough {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var rooms: [WalkthroughRoom]
    /// Set when the server signed the manifest.
    var sealedAt: Date?
    /// The server's `manifestId` for the signed manifest.
    var manifestID: String?
    var rental: Rental?

    init(id: UUID = UUID(), createdAt: Date = .now, rooms: [WalkthroughRoom], rental: Rental? = nil) {
        self.id = id
        self.createdAt = createdAt
        self.rooms = rooms
        self.rental = rental
    }

    var isSealed: Bool { sealedAt != nil }

    var totalItems: Int { rooms.reduce(0) { $0 + $1.items.count } }
    var doneItems: Int { rooms.reduce(0) { $0 + $1.doneCount } }
    var openItems: Int { totalItems - doneItems }
    /// Every photo kept so far, across rooms.
    var photoIDs: [UUID] { rooms.flatMap(\.items).flatMap(\.photoIDs) }
    /// A seal needs at least one photo: the manifest signs photos, not marks.
    var canSeal: Bool { !isSealed && !photoIDs.isEmpty }

    /// The day the walkthrough began, which stands in for occupancy when the rental has none.
    func startDay(calendar: Calendar = .current) -> CalendarDay {
        CalendarDay(createdAt, calendar: calendar)
    }

    /// Adds rooms, skipping any whose name is already in the walkthrough.
    func add(_ newRooms: [WalkthroughRoom]) {
        var updated = rooms
        for room in newRooms where !updated.contains(where: { RoomName.matches($0.name, room.name) }) {
            updated.append(room)
        }
        rooms = updated
    }

    /// The tenant kept a photo for this item.
    func recordPhoto(_ photoID: UUID, room roomID: UUID, item itemID: UUID) {
        update(room: roomID, item: itemID) { item in
            if !item.photoIDs.contains(photoID) { item.photoIDs.append(photoID) }
            item.outcome = .photographed
        }
    }

    /// The tenant looked and found no damage. An item that already has photos stays photographed.
    func markNoDamage(room roomID: UUID, item itemID: UUID) {
        update(room: roomID, item: itemID) { item in
            if item.outcome == .open { item.outcome = .noDamage }
        }
    }

    /// Puts a marked item back to not looked at. An item with photos stays photographed.
    func reopen(room roomID: UUID, item itemID: UUID) {
        update(room: roomID, item: itemID) { item in
            if item.photoIDs.isEmpty { item.outcome = .open }
        }
    }

    private func update(room roomID: UUID, item itemID: UUID, _ change: (inout ChecklistItem) -> Void) {
        guard !isSealed,
              let r = rooms.firstIndex(where: { $0.id == roomID }),
              let i = rooms[r].items.firstIndex(where: { $0.id == itemID }) else { return }
        var updated = rooms
        change(&updated[r].items[i])
        rooms = updated
    }

    /// Writes changes to disk now, so a relaunch finds the tenant's progress.
    func persist() {
        try? modelContext?.save()
    }

    func seal(manifestID: String, at date: Date = .now) {
        self.manifestID = manifestID
        sealedAt = date
    }
}

extension Rental {
    /// The walkthrough in progress, else the latest one. Nil before the tenant starts.
    var currentWalkthrough: Walkthrough? {
        let all = walkthroughs.sorted { $0.createdAt < $1.createdAt }
        return all.last { !$0.isSealed } ?? all.last
    }
}
