import SwiftData
import SwiftUI

nonisolated struct AskReply: Decodable, Sendable {
    struct Citation: Decodable, Sendable {
        var kind: String
        var ref: String
        var label: String
        var text: String
        var url: URL?
    }
    struct Sentence: Decodable, Sendable {
        var text: String
        var citations: [Citation]
    }
    struct Resource: Decodable, Sendable {
        var label: String
        var url: URL
    }
    var sentences: [Sentence]
    var outOfScope: Bool
    var message: String?
    var resources: [Resource]
}

nonisolated struct AskHistoryTurn: Encodable, Sendable {
    var role: String
    var text: String
}

/// Session history lives only in this view, separately for each rental. Leaving the
/// session or deleting everything discards it; the server receives at most six turns.
struct AskView: View {
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]
    @State private var sessions: [UUID: [Exchange]] = [:]
    @State private var question = ""
    @State private var isSending = false
    @State private var error: APIError?
    @State private var expandedCitation: String?
    @FocusState private var composerFocused: Bool

    private struct Exchange: Identifiable {
        let id = UUID()
        var question: String
        var reply: AskReply
    }
    private struct RequestBody: Encodable {
        var message: String
        var history: [AskHistoryTurn]
        var locale: String
    }
    private var rental: Rental? { Rental.current(in: rentals) }
    private var exchanges: [Exchange] { rental.flatMap { sessions[$0.id] } ?? [] }
    private var trimmedQuestion: String { question.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Ask about your rental").font(.title2.bold())
                Text("Answers show the lease clause, law, or record they come from. Your conversation is kept only in this session.")
                    .foregroundStyle(.secondary)
                if exchanges.isEmpty {
                    ForEach(Array(suggestions.enumerated()), id: \.offset) { _, suggestion in
                        Button { question = String(localized: suggestion); composerFocused = true } label: {
                            Text(suggestion).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                ForEach(exchanges) { exchange in exchangeView(exchange) }
                if isSending { ProgressView("Checking your sources…").accessibilityLabel("Checking your sources") }
                if let error { Text(error.message).foregroundStyle(.secondary) }
                if rental?.serverID == nil {
                    Text("Connect to sync this rental before asking a question.").foregroundStyle(.secondary)
                }
                TextField("Question about your rental", text: $question, axis: .vertical)
                    .lineLimit(2...8)
                    .textFieldStyle(.roundedBorder)
                    .focused($composerFocused)
                    .disabled(isSending)
                if question.count > 2000 { Text("Keep your question under 2,000 characters.").foregroundStyle(.secondary) }
                Button("Ask", systemImage: "arrow.up") { Task { await send() } }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                    .keyboardShortcut("k", modifiers: .command)
                    .disabled(isSending || trimmedQuestion.isEmpty || question.count > 2000 || rental?.serverID == nil)
                Text("Legal information, not legal advice.").font(.footnote).foregroundStyle(.secondary)
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Ask")
        .rentalSubtitle()
        .settingsToolbar()
        .rentalSwitcher()
        .onChange(of: rental?.id) { _, _ in question = ""; error = nil; expandedCitation = nil }
        .onChange(of: rentals.count) { _, _ in
            let ids = Set(rentals.map(\.id))
            sessions = sessions.filter { ids.contains($0.key) }
        }
    }

    private func exchangeView(_ exchange: Exchange) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(exchange.question).font(.headline).textSelection(.enabled)
            ForEach(Array(exchange.reply.sentences.enumerated()), id: \.offset) { sentenceIndex, sentence in
                Text(sentence.text).textSelection(.enabled)
                ForEach(Array(sentence.citations.enumerated()), id: \.offset) { citationIndex, citation in
                    let key = "\(exchange.id)-\(sentenceIndex)-\(citationIndex)"
                    Button {
                        expandedCitation = expandedCitation == key ? nil : key
                    } label: {
                        Label(citation.label, systemImage: "text.book.closed")
                            .frame(minHeight: 44, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityHint("Shows the source quote")
                    if expandedCitation == key {
                        Text(citation.text).font(.body.monospaced()).textSelection(.enabled)
                        if let url = citation.url { Link("Read the law", destination: url).frame(minHeight: 44) }
                    }
                }
            }
            if let message = exchange.reply.message { Text(message) }
            ForEach(exchange.reply.resources, id: \.url) { resource in
                Link(resource.label, destination: resource.url).frame(minHeight: 44)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private var suggestions: [LocalizedStringResource] {
        switch rental?.phase {
        case .preSigning: ["What does my lease say about fees?", "How much can my security deposit be?"]
        case .moveIn: ["When is the move-in report due?", "What evidence have I recorded?"]
        case .living: ["Can my landlord enter without notice?", "What does my lease say about repairs?"]
        case .moveOut, .ended: ["When is my deposit itemization due?", "What move-out evidence do I have?"]
        case nil: []
        }
    }

    private func send() async {
        guard !isSending, let rental, let serverID = rental.serverID, !trimmedQuestion.isEmpty, question.count <= 2000 else { return }
        let rentalID = rental.id
        let message = trimmedQuestion
        let history = (sessions[rentalID] ?? []).flatMap { exchange in
            [AskHistoryTurn(role: "user", text: exchange.question),
             AskHistoryTurn(role: "assistant", text: exchange.reply.sentences.map(\.text).joined(separator: " ").prefix(4000).description)]
        }
        isSending = true
        error = nil
        defer { isSending = false }
        do {
            let reply: AskReply = try await APIClient(auth: auth, serverURL: configuration.serverURL)
                .post("v1/rentals/\(serverID)/ask", body: RequestBody(message: message, history: Array(history.suffix(6)), locale: Locale.current.identifier.replacingOccurrences(of: "_", with: "-")))
            guard rentals.contains(where: { $0.id == rentalID }) else { return }
            sessions[rentalID, default: []].append(Exchange(question: message, reply: reply))
            if sessions[rentalID, default: []].count > 20 { sessions[rentalID]?.removeFirst() }
            if self.rental?.id == rentalID { question = ""; composerFocused = false }
        } catch {
            if self.rental?.id == rentalID { self.error = error }
        }
    }
}
