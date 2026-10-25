import Foundation

/// One message of a `text/event-stream`.
nonisolated struct ServerSentEvent: Equatable, Sendable {
    var event: String
    var data: String
    var id: String?
}

/// Turns the bytes of a `text/event-stream` into messages (the WHATWG event stream format).
///
/// It reads bytes rather than `AsyncBytes.lines`, which skips empty lines, and an empty line is what
/// ends each message.
nonisolated struct ServerSentEventDecoder: Sendable {
    private var line: [UInt8] = []
    private var event = ""
    private var data: [String] = []
    private var hasData = false
    private var lastID: String?

    /// Feeds one byte; returns the message it completes, if any.
    mutating func feed(_ byte: UInt8) -> ServerSentEvent? {
        guard byte == UInt8(ascii: "\n") else {
            line.append(byte)
            return nil
        }
        if line.last == UInt8(ascii: "\r") { line.removeLast() }
        defer { line.removeAll(keepingCapacity: true) }
        return process(String(decoding: line, as: UTF8.self))
    }

    /// Feeds a chunk; returns the messages it completes, in order.
    mutating func feed(_ bytes: some Sequence<UInt8>) -> [ServerSentEvent] {
        bytes.compactMap { feed($0) }
    }

    /// The message a stream that ended without a final empty line was in the middle of.
    mutating func finish() -> ServerSentEvent? {
        if !line.isEmpty { _ = feed(UInt8(ascii: "\n")) }
        return feed(UInt8(ascii: "\n"))
    }

    private mutating func process(_ line: String) -> ServerSentEvent? {
        if line.isEmpty { return dispatch() }
        // A comment, such as the server's keepalive.
        if line.hasPrefix(":") { return nil }
        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.hasPrefix(" ") { value = value.dropFirst() }
        } else {
            field = line[...]
            value = ""
        }
        switch field {
        case "event": event = String(value)
        case "data":
            data.append(String(value))
            hasData = true
        case "id": lastID = String(value)
        default: break
        }
        return nil
    }

    private mutating func dispatch() -> ServerSentEvent? {
        defer {
            event = ""
            data.removeAll()
            hasData = false
        }
        guard hasData else { return nil }
        return ServerSentEvent(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n"), id: lastID)
    }
}
