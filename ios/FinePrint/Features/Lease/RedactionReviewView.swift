import SwiftUI

/// The redaction review (spec §4.3 F1): every detail FinePrint will hide, which the tenant can turn
/// off one by one, plus a way to hide more text. A second view shows the lease with the hidden
/// details highlighted. Nothing is sent from here.
///
/// It replaces the Lease tab's content in place, with its own Cancel and Done buttons, and asks
/// nothing in sheets, alerts, or dialogs. Presenting, pushing, popping, or changing the navigation
/// bar from inside a tab while the deadline accessory shows sends SwiftUI into an AttributeGraph
/// update cycle whenever accessibility is on (VoiceOver, UI automation), #99.
struct RedactionReviewView: View {
    let onCancel: () -> Void
    let onDone: (LeaseScan) -> Void
    @State private var draft: LeaseScan
    @State private var mode = Mode.details
    @State private var layout: RedactionLayout?
    @State private var isAddingText = false
    @State private var textToHide = ""
    @State private var textNotFound = false
    @State private var changeCount = 0
    /// A sensitive number waiting for the tenant to confirm it may be sent as written.
    @State private var pendingShow: UUID?
    @FocusState private var isTextFieldFocused: Bool

    enum Mode: Hashable {
        case details
        case leaseText
    }

    init(scan: LeaseScan, onCancel: @escaping () -> Void, onDone: @escaping (LeaseScan) -> Void) {
        _draft = State(initialValue: scan)
        self.onCancel = onCancel
        self.onDone = onDone
    }

    var body: some View {
        VStack(spacing: 0) {
            header
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
        .task(id: draft.redactions.redactions.map(\.id)) {
            layout = await RedactionLayout.make(text: draft.text, map: draft.redactions)
        }
        .sensoryFeedback(.selection, trigger: changeCount)
    }

    /// The screen's title with Cancel and Done, as content rather than navigation bar items.
    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                cancelButton
                Spacer()
                title
                Spacer()
                doneButton
            }
            VStack(alignment: .leading, spacing: 8) {
                title
                HStack {
                    cancelButton
                    Spacer()
                    doneButton
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var title: some View {
        Text("Hidden Details")
            .font(.headline)
            .accessibilityAddTraits(.isHeader)
    }

    private var cancelButton: some View {
        Button("Cancel", role: .cancel, action: onCancel)
            .frame(minHeight: 44)
            .accessibilityIdentifier("lease.review.cancel")
    }

    private var doneButton: some View {
        Button("Done") { onDone(draft) }
            .buttonStyle(.borderedProminent)
            .frame(minHeight: 44)
            .accessibilityIdentifier("lease.review.done")
    }

    // MARK: Details

    private var details: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    LeaseCard {
                        Text("FinePrint hides these before your lease leaves this phone. Tap one to send it as written, or hide more text.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Divider()
                        if isAddingText {
                            hideTextRows
                        } else {
                            Button {
                                isAddingText = true
                                isTextFieldFocused = true
                            } label: {
                                Label("Hide More Text", systemImage: "plus.circle")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                            .accessibilityIdentifier("lease.review.add")
                        }
                    }
                    Text("^[\(draft.redactions.hiddenCount) detail](inflect: true) hidden")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                        .accessibilityIdentifier("lease.review.hiddenCount")
                }

                if draft.redactions.redactions.isEmpty {
                    LeaseCard {
                        Text("FinePrint didn't find any names, addresses, or numbers to hide. Check the lease text, and hide anything personal yourself.")
                            .foregroundStyle(.secondary)
                    }
                }

                ForEach(RedactionGroup.allCases, id: \.self) { group in
                    let indices = draft.redactions.redactions.indices.filter { group.contains(draft.redactions.redactions[$0]) }
                    if !indices.isEmpty {
                        LeaseCard(title: group.title) {
                            ForEach(indices, id: \.self) { index in
                                let redaction = draft.redactions.redactions[index]
                                if index != indices.first { Divider() }
                                RedactionRow(redaction: redaction, count: layout?.counts[redaction.id]) {
                                    requestToggle(redaction.id)
                                }
                                if pendingShow == redaction.id {
                                    confirmShowRows(redaction)
                                }
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .leaseBottomClearance()
    }

    /// Hide More Text, inline: type the words, and FinePrint hides them everywhere they appear.
    @ViewBuilder
    private var hideTextRows: some View {
        TextField("Text to hide", text: $textToHide, prompt: Text("A name, a unit number, or other words"))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .focused($isTextFieldFocused)
            .onSubmit(hideTypedText)
            .onChange(of: textToHide) { textNotFound = false }
            .accessibilityIdentifier("lease.hide.field")
        if textNotFound {
            Label {
                Text("That text isn't in your lease. Check the spelling.")
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.hide.notFound")
        }
        Button("Hide Everywhere", action: hideTypedText)
            .frame(minHeight: 44)
            .disabled(textToHide.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("lease.hide.confirm")
        Button("Cancel", role: .cancel) {
            closeHideText()
        }
        .frame(minHeight: 44)
        .accessibilityIdentifier("lease.hide.cancel")
    }

    /// The question before a sensitive number is sent as written, as rows under it.
    @ViewBuilder
    private func confirmShowRows(_ redaction: Redaction) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Send this \(Text(redaction.kind.title)) as written?")
                .font(.subheadline.weight(.semibold))
            Text("Anyone who sees the lease text on the server could read it. Most leases can be checked without it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        Button("Send as Written", role: .destructive) {
            pendingShow = nil
            toggle(redaction.id)
        }
        .accessibilityIdentifier("lease.review.confirmShow")
        Button("Keep Hidden") {
            pendingShow = nil
        }
        .accessibilityIdentifier("lease.review.keepHidden")
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
            .leaseBottomClearance()
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
    /// or a date of birth, asks first: one stray tap should not send it. From the lease text, the
    /// question shows in Details.
    private func requestToggle(_ id: UUID) {
        guard let redaction = draft.redactions[id] else { return }
        if redaction.isHidden, redaction.isSensitiveNumber {
            pendingShow = id
            mode = .details
            AccessibilityNotification.Announcement(String(localized: "Send this \(redaction.kind.title) as written? Choose Send as Written or Keep Hidden.")).post()
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

    private func hideTypedText() {
        let value = textToHide.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        let lease = draft.text
        guard let redaction = draft.redactions.hide(value, in: lease) else {
            textNotFound = true
            AccessibilityNotification.Announcement(String(localized: "That text isn't in your lease.")).post()
            return
        }
        changeCount += 1
        let places = TextMatcher.ranges(of: redaction.original, in: lease, mode: .phrase).count
        AccessibilityNotification.Announcement(String(localized: "Hidden in \(places) places.")).post()
        closeHideText()
    }

    private func closeHideText() {
        textToHide = ""
        textNotFound = false
        isTextFieldFocused = false
        isAddingText = false
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

#Preview {
    let text = "Tenant: Jordan Lee\nLandlord: Harbor Point Properties LLC\nRent is $1,450.00 per month."
    RedactionReviewView(
        scan: LeaseScan(
            rentalID: UUID(),
            source: .pdf,
            pages: [LeasePage(text: text, method: .textLayer)],
            redactions: PIIDetector().redactionMap(for: text)
        ),
        onCancel: {},
        onDone: { _ in }
    )
}
