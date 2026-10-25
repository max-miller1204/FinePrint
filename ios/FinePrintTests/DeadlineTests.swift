import Foundation
import Testing
@testable import FinePrint

@Suite("Next deadline")
struct DeadlineTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    func date(_ day: Int, hour: Int = 12) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 8, day: day, hour: hour))!
    }

    @Test func `counts whole calendar days`() {
        let deadline = NextDeadline(title: "Object to move-in report", dueDay: CalendarDay(year: 2026, month: 8, day: 17))
        #expect(deadline.countdown(from: date(14, hour: 23), calendar: calendar) == .daysLeft(3))
        #expect(deadline.countdown(from: date(16), calendar: calendar) == .daysLeft(1))
        #expect(deadline.countdown(from: date(17, hour: 20), calendar: calendar) == .dueToday)
        #expect(deadline.countdown(from: date(18), calendar: calendar) == .pastDue)
    }

    #if DEBUG
    @Test func `sample deadline is three days out`() throws {
        let store = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .present), now: date(14), calendar: calendar)
        let next = try #require(store.next)
        #expect(next.title == "Object to move-in report")
        #expect(next.countdown(from: date(14), calendar: calendar) == .daysLeft(3))
    }

    @Test func `empty stub hides the accessory`() {
        let store = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty))
        #expect(store.next == nil)
    }

    @Test func `debug builds show the sample by default`() {
        let store = DeadlineStore(launchOptions: LaunchOptions())
        #expect(store.next != nil)
    }

    @Test func `developer toggle switches between states`() {
        let store = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty))
        store.showsSample = true
        #expect(store.next != nil)
        store.showsSample = false
        #expect(store.next == nil)
    }
    #endif
}

@Suite("Developer menu unlock")
struct DeveloperUnlockTests {
    let start = Date(timeIntervalSinceReferenceDate: 0)

    @Test func `five quick taps unlock`() {
        var unlock = DeveloperUnlock()
        let results = (0..<5).map { unlock.registerTap(at: start.addingTimeInterval(Double($0) * 0.3)) }
        #expect(results == [false, false, false, false, true])
    }

    @Test func `slow taps do not unlock`() {
        var unlock = DeveloperUnlock()
        let results = (0..<5).map { unlock.registerTap(at: start.addingTimeInterval(Double($0) * 1.0)) }
        #expect(results.allSatisfy { !$0 })
    }
}

@Suite("Severity tokens")
struct SeverityTests {
    @Test(arguments: Severity.allCases)
    func `every severity has a symbol and a word`(severity: Severity) {
        #expect(!severity.symbolName.isEmpty)
        #expect(!String(localized: severity.title).isEmpty)
    }

    @Test func `spec symbols`() {
        #expect(Severity.unenforceable.symbolName == "exclamationmark.octagon.fill")
        #expect(Severity.ask.symbolName == "exclamationmark.triangle.fill")
        #expect(Severity.info.symbolName == "info.circle.fill")
        #expect(Severity.verified.symbolName == "checkmark.seal.fill")
    }
}
