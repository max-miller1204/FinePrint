#if DEBUG
import Foundation
import OSLog
import Synchronization

/// DEBUG builds only, on with `-FinePrintHangWatchdog <file>`: watches the main thread from a
/// background thread so a frozen screen fails an e2e run in seconds with its stack, instead of
/// surfacing minutes later as a simulator-driver timeout ("snapshot failed: Daemon request timed
/// out"), which reads like flaky tooling.
///
/// Each stall longer than `reportAfter` appends a `hang` line to `<file>`. A stall longer than
/// `abortAfter` appends an `abort` line and stops the app, so the crash report in
/// `~/Library/Logs/DiagnosticReports/FinePrint-*.ips` holds the main thread's stack. The e2e
/// fixture in `e2e/tests/ios/fixtures.ts` reads the file after every test.
nonisolated final class HangWatchdog: Sendable {
    static let reportAfter: Duration = .seconds(2)
    static let abortAfter: Duration = .seconds(10)
    private static let tickNanoseconds: UInt64 = 250_000_000

    private let file: URL
    /// The last time the main thread ran a ping, in `DispatchTime` nanoseconds.
    private let lastPong = Atomic<UInt64>(DispatchTime.now().uptimeNanoseconds)
    private let stopped = Atomic<Bool>(false)
    private let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "HangWatchdog")

    private init(file: URL) {
        self.file = file
    }

    @discardableResult
    static func start(reportingTo path: String) -> HangWatchdog {
        let watchdog = HangWatchdog(file: URL(fileURLWithPath: path))
        let thread = Thread { watchdog.run() }
        thread.name = "HangWatchdog"
        thread.qualityOfService = .userInteractive
        thread.start()
        return watchdog
    }

    /// Ends the watch after the current tick. The app never calls it; tests do.
    func stop() {
        stopped.store(true, ordering: .relaxed)
    }

    private func run() {
        var lastTick = DispatchTime.now().uptimeNanoseconds
        var reported = false
        while !stopped.load(ordering: .relaxed) {
            DispatchQueue.main.async { [self] in
                lastPong.store(DispatchTime.now().uptimeNanoseconds, ordering: .relaxed)
            }
            Thread.sleep(forTimeInterval: Double(Self.tickNanoseconds) / 1e9)
            let now = DispatchTime.now().uptimeNanoseconds
            // A tick far longer than asked for means the whole process was suspended (background,
            // debugger), not that the main thread hung. Start counting again.
            if now - lastTick > Self.tickNanoseconds * 4 {
                lastPong.store(now, ordering: .relaxed)
            }
            lastTick = now
            // The main thread may store a time later than `now` between the two reads.
            let pong = lastPong.load(ordering: .relaxed)
            let stalled = Duration.nanoseconds(Int64(now > pong ? now - pong : 0))
            if stalled >= Self.abortAfter {
                record("abort main thread blocked \(Self.seconds(stalled)) s")
                fatalError("HangWatchdog: main thread blocked for \(Self.seconds(stalled)) s")
            } else if stalled >= Self.reportAfter, !reported {
                reported = true
                record("hang main thread blocked \(Self.seconds(stalled)) s")
            } else if stalled < Self.reportAfter, reported {
                reported = false
                record("recovered")
            }
        }
    }

    private func record(_ event: String) {
        logger.error("\(event, privacy: .public)")
        let line = "\(Date.now.ISO8601Format()) \(event)\n"
        guard let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: file)
        }
    }

    private static func seconds(_ duration: Duration) -> String {
        let value = Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
        return value.formatted(.number.precision(.fractionLength(1)))
    }
}
#endif
