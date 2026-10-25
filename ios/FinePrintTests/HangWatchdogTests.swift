import Foundation
import Testing
@testable import FinePrint

@Suite("Hang watchdog")
struct HangWatchdogTests {
    @Test func `records a blocked main thread and its recovery`() async throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "hangs-\(UUID().uuidString).log")
        defer { try? FileManager.default.removeItem(at: file) }
        let watchdog = HangWatchdog.start(reportingTo: file.path)
        // Another test that blocks the main thread for 10 s must not trip the abort.
        defer { watchdog.stop() }

        // Longer than `reportAfter`, well short of `abortAfter`.
        await MainActor.run { Thread.sleep(forTimeInterval: 3) }
        try await Task.sleep(for: .seconds(1))

        let lines = try String(contentsOf: file, encoding: .utf8).split(separator: "\n")
        #expect(lines.contains { $0.contains(" hang main thread blocked ") })
        #expect(lines.last?.hasSuffix(" recovered") == true)
    }
}
