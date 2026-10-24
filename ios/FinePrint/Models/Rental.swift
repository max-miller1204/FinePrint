import Foundation
import SwiftData

/// A tenancy. Every lease, photo, letter, and deadline will belong to one rental (spec §4.1).
@Model
final class Rental {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date

    init(id: UUID = UUID(), name: String, createdAt: Date = .now) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
    }
}
