import Foundation

/// Counts quick taps on the Version row. Five taps within three seconds reveal the
/// developer menu, so it is deliberate but needs no special knowledge beyond the README.
nonisolated struct DeveloperUnlock: Equatable, Sendable {
    static let requiredTaps = 5
    static let window: TimeInterval = 3

    private var taps: [Date] = []

    /// Records a tap and returns true when this tap completes the unlock sequence.
    mutating func registerTap(at date: Date) -> Bool {
        taps.removeAll { date.timeIntervalSince($0) > Self.window }
        taps.append(date)
        guard taps.count >= Self.requiredTaps else { return false }
        taps.removeAll()
        return true
    }
}
