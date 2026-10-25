import SwiftUI

/// The redaction review (spec §4.3 F1): every detail FinePrint will hide, which the tenant can turn
/// off one by one, plus a way to hide more text. A second view shows the lease with the hidden
/// details highlighted. Nothing is sent from here.
struct RedactionReviewView: View {
    let onDone: (LeaseScan) -> Void
    private let original: LeaseScan
    @State private var draft: LeaseScan
    @State private var mode = Mode.details
    @State private var layout: RedactionLayout?
    @State private var isAddingText = false
    @State private var changeCount = 0
    /// A sensitive number waiting for the tenant to confirm it may be sent as written.
    @State private var pendingShow: Redaction?
    @Environment(\.dismiss) private var dismiss

    enum Mode: Hashable {
        case details
        case leaseText
    }

    init(scan: LeaseScan, onDone: @escaping (LeaseScan) -> Void) {
        original = scan
        _draft = State(initialValue: scan)
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Show", selection: $mode) {
                    Text("Details").tag(Mode.details)
                    Text("Lease Text").tag(Mode.leaseText)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .accessibilityIdentifier("lease.review.mode")

                switch mode {
                case .details: details
                case .leaseText: leaseText
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Hidden Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                        .accessibilityIdentifier("lease.review.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onDone(draft) }
                        .accessibilityIdentifier("lease.review.done")
                }
            }
            .sheet(isPresented: $isAddingText) {
                HideTextSheet { text in hide(text) }
            }
            .task(id: draft.redactions.redactions.map(\.id)) {
                layout = await RedactionLayout.make(text: draft.text, map: draft.redactions)
            }
            .sensoryFeedback(.selection, trigger: changeCount)
            .confirmationDialog(
                Text("Send this \(Text(pendingShow?.kind.title ?? "detail")) as written?"),
                isPresented: Binding { pendingShow != nil } set: { if !$0 { pendingShow = nil } },
                titleVisibility: .visible,
                presenting: pendingShow
            ) { redaction in
                Button("Send as Written", role: .destructive) { toggle(redaction.id) }
                    .accessibilityIdentifier("lease.review.confirmShow")
                Button("Keep Hidden", role: .cancel) {}
            } message: { _ in
                Text("Anyone who sees the lease text on the server could read it. Most leases can be checked without it.")
            }
        }
        .interactiveDismissDisabled(draft != original)
    }

    // MARK: Details

    private var details: some View {
        List {
            Section {
                Text("FinePrint hides these before your lease leaves this phone. Tap one to send it as written, or hide more text.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button {
                    isAddingText = true
                } label: {
                    Label("Hide More Text", systemImage: "plus.circle")
                }
                .accessibilityIdentifier("lease.review.add")
            } footer: {
                Text("^[\(draft.redactions.hiddenCount) detail](inflect: true) hidden")
                    .accessibilityIdentifier("lease.review.hiddenCount")
            }

            if draft.redactions.redactions.isEmpty {
                Section {
                    Text("FinePrint didn't find any names, addresses, or numbers to hide. Check the lease text, and hide anything personal yourself.")
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(RedactionGroup.allCases, id: \.self) { group in
                let indices = draft.redactions.redactions.indices.filter { group.contains(draft.redactions.redactions[$0]) }
                if !indices.isEmpty {
                    Section {
                        ForEach(indices, id: \.self) { index in
                            let redaction = draft.redactions.redactions[index]
                            RedactionRow(redaction: redaction, count: layout?.counts[redaction.id]) {
                                requestToggle(redaction.id)
                            }
                        }
                    } header: {
                        Text(group.title)
                    }
                }
            }
        }
    }

    // MARK: Lease text

    @ViewBuilder
    private var leaseText: some View {
        if let layout {
            let text = draft.text
            let hidden = draft.redactions.resolved(layout.occurrences)
            let paragraphs = layout.paragraphs.enumerated().map { index, range in
                LeaseParagraph(id: index, range: range, hidden: hidden.filter { $0.range.overlaps(range) })
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(paragraphs) { paragraph in
                        LeaseParagraphView(paragraph: paragraph, text: text, map: draft.redactions) { id in
                            requestToggle(id)
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(.systemBackground))
            .accessibilityRotor(
                "Hidden Details",
                entries: paragraphs.filter { !$0.hidden.isEmpty }.map { RotorEntry(id: $0.id, label: $0.hiddenNames(in: draft.redactions)) },
                entryID: \.id,
                entryLabel: \.label
            )
            .accessibilityIdentifier("lease.review.text")
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Changes

    /// Hiding is immediate. Showing a Social Security, account, card, routing, or license number,
    /// or a date of birth, asks first: one stray tap should not send it.
    private func requestToggle(_ id: UUID) {
        guard let redaction = draft.redactions[id] else { return }
        if redaction.isHidden, redaction.isSensitiveNumber {
            pendingShow = redaction
        } else {
            toggle(id)
        }
    }

    private func toggle(_ id: UUID) {
        guard let index = draft.redactions.redactions.firstIndex(where: { $0.id == id }) else { return }
        draft.redactions.redactions[index].isHidden.toggle()
        changeCount += 1
        let redaction = draft.redactions.redactions[index]
        AccessibilityNotification.Announcement(
            redaction.isHidden ? String(localized: "\(redaction.original) hidden") : String(localized: "\(redaction.original) will be sent as written")
        ).post()
    }

    /// Hides `text` everywhere. Returns how many places, or nil when it is not in the lease.
    private func hide(_ text: String) -> Int? {
        let lease = draft.text
        guard let redaction = draft.redactions.hide(text, in: lease) else { return nil }
        changeCount += 1
        let places = TextMatcher.ranges(of: redaction.original, in: lease, mode: .phrase).count
        AccessibilityNotification.Announcement(String(localized: "Hidden in \(places) places.")).post()
        return places
    }
}

/// Sections of the review list.
enum RedactionGroup: CaseIterable {
    case people
    case companies
    case places
    case contact
    case numbers
    case added

    var title: LocalizedStringResource {
        switch self {
        case .people: "People"
        case .companies: "Companies"
        case .places: "Addresses and Places"
        case .contact: "Phone, Email, and Web"
        case .numbers: "Numbers and IDs"
        case .added: "Added by You"
        }
    }

    func contains(_ redaction: Redaction) -> Bool {
        if redaction.addedByTenant { return self == .added }
        return switch redaction.kind {
        case .tenant, .landlord, .manager, .guarantor, .occupant, .name: self == .people
        case .organization: self == .companies
        case .place, .address: self == .places
        case .phone, .email, .link: self == .contact
        case .ssn, .bankAccount, .routingNumber, .cardNumber, .birthDate, .driversLicense: self == .numbers
        case .custom: self == .added
        }
    }
}

/// One detail: what it is, what the server sees instead, and whether it is hidden. The whole row is
/// one button that switches it, so VoiceOver reads it as one toggle.
struct RedactionRow: View {
    let redaction: Redaction
    let count: Int?
    /// Asks the review to switch it, which confirms first before showing an ID or account number.
    let onTap: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: onTap) {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: redaction.original)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .strikethrough(redaction.isHidden, color: .secondary)
                        .lineLimit(nil)
                    Text(redaction.kind.title)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Group {
                        if redaction.isHidden {
                            Text("Sent as \(redaction.placeholder)")
                        } else {
                            Text("Sent as written")
                        }
                    }
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HiddenBadge(isHidden: redaction.isHidden)
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(redaction.original), \(Text(redaction.kind.title))"))
        .accessibilityValue(redaction.isHidden ? Text("Hidden") : Text("Sent as written"))
        .accessibilityHint(Text("Switches whether this detail is hidden"))
        .accessibilityAddTraits([.isButton, .isToggle])
        .accessibilityCustomContent("Sent as", Text(verbatim: redaction.isHidden ? redaction.placeholder : redaction.original))
        .accessibilityCustomContent("Appears", count.map { Text("^[\($0) time](inflect: true)") } ?? Text(verbatim: "…"))
        .accessibilityIdentifier("lease.redaction.\(redaction.placeholder.trimmingCharacters(in: CharacterSet(charactersIn: "[]")))")
    }
}

/// Symbol plus word, so the state never rests on color alone.
private struct HiddenBadge: View {
    let isHidden: Bool

    var body: some View {
        Label {
            Text(isHidden ? "Hidden" : "Shown")
        } icon: {
            Image(systemName: isHidden ? "eye.slash.fill" : "eye")
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(isHidden ? Color.accentColor : Color.secondary)
        .labelStyle(.titleAndIcon)
        .fixedSize()
    }
}

/// A "Hidden Details" rotor stop: a paragraph, named by what it hides.
struct RotorEntry {
    let id: Int
    let label: String
}

struct LeaseParagraph: Identifiable {
    let id: Int
    let range: Range<String.Index>
    /// Hidden occurrences that touch this paragraph, in order, not overlapping.
    let hidden: [RedactionOccurrence]

    func hiddenNames(in map: RedactionMap) -> String {
        var seen = Set<UUID>()
        return hidden.compactMap { occurrence in
            guard seen.insert(occurrence.redactionID).inserted else { return nil }
            return map[occurrence.redactionID]?.original
        }
        .formatted(.list(type: .and))
    }
}

/// One paragraph of the lease with its hidden details highlighted and underlined. VoiceOver reads
/// "Jordan Lee, hidden," at each one, and its actions show or hide each detail in the paragraph.
struct LeaseParagraphView: View {
    let paragraph: LeaseParagraph
    let text: String
    let map: RedactionMap
    let onToggle: (UUID) -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Text(attributed)
            .font(.body)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: spoken))
            .accessibilityActions {
                ForEach(redactionsInParagraph) { redaction in
                    Button(redaction.isHidden ? String(localized: "Show \(redaction.original)") : String(localized: "Hide \(redaction.original)")) {
                        onToggle(redaction.id)
                    }
                }
            }
    }

    /// Every detail that appears here, hidden or not, so a shown one can be hidden again.
    private var redactionsInParagraph: [Redaction] {
        let paragraphText = text[paragraph.range]
        return map.redactions.filter { redaction in
            paragraph.hidden.contains { $0.redactionID == redaction.id }
                || (!redaction.isHidden && !TextMatcher.ranges(of: redaction.original, in: String(paragraphText), mode: .phrase).isEmpty)
        }
    }

    private var segments: [(text: Substring, isHidden: Bool)] {
        var segments: [(Substring, Bool)] = []
        var cursor = paragraph.range.lowerBound
        for occurrence in paragraph.hidden {
            let start = max(occurrence.range.lowerBound, paragraph.range.lowerBound)
            let end = min(occurrence.range.upperBound, paragraph.range.upperBound)
            guard start < end else { continue }
            if cursor < start { segments.append((text[cursor..<start], false)) }
            segments.append((text[start..<end], true))
            cursor = end
        }
        if cursor < paragraph.range.upperBound { segments.append((text[cursor..<paragraph.range.upperBound], false)) }
        return segments
    }

    private var attributed: AttributedString {
        var result = AttributedString()
        let highlight = Color.yellow.opacity(contrast == .increased ? 0.6 : 0.35)
        for segment in segments {
            var piece = AttributedString(segment.text.replacingOccurrences(of: "\n", with: " "))
            if segment.isHidden {
                piece.backgroundColor = highlight
                piece.underlineStyle = .single
            }
            result += piece
        }
        return result
    }

    private var spoken: String {
        segments.map { segment in
            let words = segment.text.replacingOccurrences(of: "\n", with: " ")
            return segment.isHidden ? String(localized: "\(words), hidden,") : words
        }
        .joined()
    }
}

/// Hides text the detectors missed, everywhere it appears in the lease.
struct HideTextSheet: View {
    /// Returns how many places were hidden, or nil when the text is not in the lease.
    let onHide: (String) -> Int?
    @State private var text = ""
    @State private var notFound = false
    @FocusState private var isFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Text to hide", text: $text, prompt: Text("A name, a unit number, or other words"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($isFocused)
                        .onSubmit(hide)
                        .accessibilityIdentifier("lease.hide.field")
                } footer: {
                    Text("FinePrint hides it everywhere it appears in your lease. Type it as it is written.")
                }

                if notFound {
                    Label {
                        Text("That text isn't in your lease. Check the spelling.")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .accessibilityIdentifier("lease.hide.notFound")
                }

                Section {
                    Button("Hide Everywhere", action: hide)
                        .disabled(trimmed.isEmpty)
                        .accessibilityIdentifier("lease.hide.confirm")
                }
            }
            .navigationTitle("Hide More Text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                        .accessibilityIdentifier("lease.hide.cancel")
                }
            }
            .onChange(of: text) { notFound = false }
            .onAppear { isFocused = true }
        }
        .presentationDetents([.medium, .large])
    }

    private func hide() {
        guard !trimmed.isEmpty else { return }
        if onHide(trimmed) != nil {
            dismiss()
        } else {
            notFound = true
            AccessibilityNotification.Announcement(String(localized: "That text isn't in your lease.")).post()
        }
    }
}

#Preview {
    RedactionReviewView(
        scan: LeaseScan(
            rentalID: UUID(),
            source: .pdf,
            pages: [LeasePage(text: "Tenant: Jordan Lee\nLandlord: Harbor Point Properties LLC\nRent is $1,450.00 per month.", method: .textLayer)],
            redactions: PIIDetector().redactionMap(for: "Tenant: Jordan Lee\nLandlord: Harbor Point Properties LLC\nRent is $1,450.00 per month.")
        )
    ) { _ in }
}
