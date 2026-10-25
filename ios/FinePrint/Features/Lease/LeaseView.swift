import SwiftData
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// The Lease tab (spec §4.3 F1): scan or import the current rental's lease, read it on the phone,
/// review what is hidden before anything is sent, then check it against Virginia law and read the
/// findings.
///
/// Nothing here is presented or pushed from inside the tab: the review, a finding, and the clause
/// explorer replace the summary in place, questions are inline rows, and the file picker and document camera are `SystemPicker`s
/// that `RootTabView` presents. A sheet, alert, or dialog from inside a tab while the deadline
/// accessory shows sends SwiftUI into an AttributeGraph update cycle whenever accessibility is on
/// (VoiceOver, UI automation), and so did popping a pushed review (#99).
struct LeaseView: View {
    @Environment(\.leaseStore) private var store
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AppNavigation.self) private var navigation
    @Environment(AuthSession.self) private var auth
    @Environment(UserSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]
    @State private var model = LeaseModel()
    @State private var analysis = LeaseAnalysisModel()
    @State private var isScannerUnavailable = false
    /// What shows in place of the summary.
    @State private var screen: LeaseScreen = .summary
    /// The finding the tenant last opened, so the summary scrolls back to it.
    @State private var lastFindingID: String?

    private var currentRentalID: UUID? { Rental.current(in: rentals)?.id }

    /// The reviewed lease the check works on.
    private var readyScan: LeaseScan? {
        if case .ready(let scan) = model.phase, model.reviewing == nil { return scan }
        return nil
    }

    private var client: APIClient { APIClient(auth: auth, serverURL: configuration.serverURL) }

    var body: some View {
        content
            .background(Color(.systemBackground))
            .navigationTitle("Lease")
            .rentalSubtitle()
            .settingsToolbar()
            .rentalSwitcher()
            .task(id: currentRentalID) {
                screen = .summary
                lastFindingID = nil
                await model.load(rentalID: currentRentalID, store: store)
            }
            .task(id: readyScan) {
                #if DEBUG
                analysis.stubFindingCount = configuration.stubFindingCount
                #endif
                await analysis.load(scan: readyScan, store: store, client: client)
            }
            .onChange(of: reduceMotion, initial: true) { _, reduceMotion in
                analysis.reduceMotion = reduceMotion
            }
            .onChange(of: settings.language, initial: true) { _, language in
                analysis.language = language.rawValue
            }
            .sensoryFeedback(.warning, trigger: analysis.unenforceableCount) { old, new in new > old }
            .onChange(of: navigation.systemPickerResult?.id) {
                guard let result = navigation.systemPickerResult, navigation.selectedTab == .lease else { return }
                navigation.systemPickerResult = nil
                switch result.content {
                case .file(let url): model.importPDF(at: url, store: store)
                case .scan(let images): model.importScan(images, store: store)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if let reviewing = model.reviewing {
            // In place of the summary, not pushed or in a sheet (see the type's comment).
            RedactionReviewView(scan: reviewing) {
                model.reviewing = nil
            } onDone: { reviewed in
                Task { await model.finishReview(reviewed, store: store) }
            }
            .id(reviewing.id)
        } else if case .ready(let scan) = model.phase {
            switch screen {
            case .summary:
                phaseContent
            case .sent:
                LeaseSentTextView(scan: scan) {
                    screen = .summary
                }
            case .finding(let id):
                // A reset (a new review, another rental) can take the finding away.
                if let finding = analysis.finding(id: id) {
                    FindingDetailView(
                        finding: finding,
                        language: analysis.language,
                        onClose: { screen = .summary },
                        onShowInLease: analysis.sentText == nil ? nil : { screen = .explorer(focus: finding.quoteSpan) }
                    )
                    .id(id)
                } else {
                    phaseContent
                }
            case .explorer(let focus):
                if let text = analysis.sentText {
                    ClauseExplorerView(
                        text: text,
                        findings: analysis.findings,
                        language: analysis.language,
                        focus: focus,
                        onClose: { screen = lastFindingID.map(LeaseScreen.finding) ?? .summary },
                        onOpenFinding: open
                    )
                } else {
                    phaseContent
                }
            }
        } else {
            phaseContent
        }
    }

    private func open(_ finding: LeaseFinding) {
        lastFindingID = finding.id
        screen = .finding(finding.id)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .empty:
            emptyState
        case .reading, .redacting:
            progress
        case .failed(let failure):
            failed(failure)
        case .ready(let scan):
            LeaseSummaryView(scan: scan, analysis: analysis, returnToFindingID: lastFindingID) {
                model.reviewing = scan
            } onShowSent: {
                screen = .sent
            } onRemove: {
                Task {
                    await analysis.forget(store: store, rentalID: scan.rentalID)
                    await model.removeLease(store: store)
                }
            } onAnalyze: {
                analysis.analyze(rentals: rentals, settings: settings, store: store, client: client)
            } onRetry: {
                analysis.retry(rentals: rentals, settings: settings, store: store, client: client)
            } onOpenFinding: { finding in
                open(finding)
            } onShowInLease: { focus in
                lastFindingID = nil
                screen = .explorer(focus: focus)
            }
        }
    }

    private var emptyState: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    ContentUnavailableView {
                        Label("No lease yet", systemImage: "doc.text.magnifyingglass")
                    } description: {
                        Text("Add your lease and FinePrint will check it against Virginia law and explain each part in plain words.")
                    } actions: {
                        VStack(spacing: 12) {
                            Button {
                                scan()
                            } label: {
                                Label("Scan Lease", systemImage: "doc.viewfinder")
                                    .frame(maxWidth: .infinity, minHeight: 32)
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("lease.scan")

                            Button {
                                importPDF()
                            } label: {
                                Label("Import PDF", systemImage: "doc.badge.plus")
                                    .frame(maxWidth: .infinity, minHeight: 32)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("lease.importPDF")

                            if isScannerUnavailable {
                                Label {
                                    Text("This device can't scan documents. Import a PDF of your lease instead.")
                                } icon: {
                                    Image(systemName: "camera.badge.ellipsis")
                                        .accessibilityHidden(true)
                                }
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .accessibilityIdentifier("lease.scanUnavailable")
                            }
                        }
                        .frame(maxWidth: 320)
                    }
                    Label {
                        Text("Your lease is read on this phone. Names, addresses, and account numbers are hidden before anything is sent, and you can check each one.")
                    } icon: {
                        Image(systemName: "lock.shield")
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    LegalFooter()
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
    }

    private var progress: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text(model.phase == .reading ? "Reading your lease…" : "Finding personal details to hide…")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("This happens on your phone. Nothing is sent.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("lease.progress")
    }

    private func failed(_ failure: LeaseFailure) -> some View {
        ContentUnavailableView {
            Label("Couldn't read your lease", systemImage: "exclamationmark.triangle")
        } description: {
            Text(failure.message)
        } actions: {
            Button("Try Again") {
                model.dismissFailure()
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("lease.tryAgain")
        }
        .accessibilityIdentifier("lease.error")
    }

    private func scan() {
        #if DEBUG
        if let fixture = configuration.fixtureLeaseFile {
            model.importFixture(at: fixture, as: .scan, store: store)
            return
        }
        #endif
        if VNDocumentCameraViewController.isSupported {
            navigation.systemPicker = .documentScan
        } else {
            isScannerUnavailable = true
            AccessibilityNotification.Announcement(String(localized: "This device can't scan documents. Import a PDF of your lease instead.")).post()
        }
    }

    private func importPDF() {
        #if DEBUG
        if let fixture = configuration.fixtureLeaseFile {
            model.importFixture(at: fixture, as: .pdf, store: store)
            return
        }
        #endif
        navigation.systemPicker = .pdfFile
    }
}

/// "Legal information, not legal advice." under the Lease, Repairs, Ask, and Letters content.
struct LegalFooter: View {
    var body: some View {
        Text("Legal information, not legal advice.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding([.horizontal, .bottom])
    }
}

extension View {
    /// Room below a lease screen's scrolling content, so its last rows scroll fully clear of the
    /// floating tab bar and the next-deadline accessory, which float over content.
    func leaseBottomClearance() -> some View {
        safeAreaPadding(.bottom, 72)
    }
}

/// A grouped block on the lease screens: an optional heading, rows on a rounded card, an optional
/// footer. The lease screens use these in a `ScrollView` rather than a `List`: a `List` in this tab
/// with a menu, sheet, or navigation transition over it stalls SwiftUI under accessibility (#99).
struct LeaseCard<Content: View>: View {
    var title: LocalizedStringResource?
    var footer: LocalizedStringResource?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    .accessibilityAddTraits(.isHeader)
            }
            VStack(alignment: .leading, spacing: 12) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
            if let footer {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
        }
    }
}

/// The current rental's lease once it has been read: what was read, what is hidden, and what
/// would be sent.
struct LeaseSummaryView: View {
    let scan: LeaseScan
    let analysis: LeaseAnalysisModel
    /// The finding the tenant came back from, to scroll to.
    let returnToFindingID: String?
    let onReview: () -> Void
    let onShowSent: () -> Void
    let onRemove: () -> Void
    let onAnalyze: () -> Void
    let onRetry: () -> Void
    let onOpenFinding: (LeaseFinding) -> Void
    let onShowInLease: (TextSpan?) -> Void
    @State private var isConfirmingRemove = false

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LeaseCard {
                    status
                    Divider()
                    Button(action: onReview) {
                        Label("Review Hidden Details", systemImage: "list.bullet.rectangle")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .accessibilityIdentifier("lease.review")
                    Divider()
                    Button(action: onShowSent) {
                        Label("See What Gets Sent", systemImage: "paperplane")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .disabled(!scan.isReviewed)
                    .accessibilityIdentifier("lease.sentPreview")
                }

                if scan.isReviewed {
                    LeaseFindingsSection(
                        analysis: analysis,
                        onAnalyze: onAnalyze,
                        onRetry: onRetry,
                        onOpenFinding: onOpenFinding,
                        onShowInLease: onShowInLease
                    )
                }

                LeaseCard(title: "Your Lease") {
                    LabeledContent("Pages") {
                        Text(scan.pages.count, format: .number)
                    }
                    Divider()
                    LabeledContent("Read From") {
                        Text(readFrom)
                    }
                    .accessibilityIdentifier("lease.readFrom")
                    Divider()
                    LabeledContent("Hidden Details") {
                        Text(scan.redactions.hiddenCount, format: .number)
                    }
                    .accessibilityIdentifier("lease.hiddenCount")
                }

                LeaseCard(footer: "Your scan, its full text, and the hidden details stay on this phone.") {
                    if isConfirmingRemove {
                        // Asked in a row, not a dialog (see `LeaseView`).
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Remove this lease from your phone?")
                                .font(.subheadline.weight(.semibold))
                            Text("The scan, its text, and the list of hidden details are deleted from this phone.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        Button("Remove Lease", role: .destructive, action: onRemove)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("lease.remove.confirm")
                        Button("Keep Lease") { isConfirmingRemove = false }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("lease.remove.cancel")
                    } else {
                        Button("Remove Lease", role: .destructive) {
                            isConfirmingRemove = true
                            AccessibilityNotification.Announcement(String(localized: "Remove this lease from your phone? Choose Remove Lease or Keep Lease.")).post()
                        }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("lease.remove")
                    }
                }
                .id(Self.removeCardID)

                LegalFooter()
                    .frame(maxWidth: .infinity)
            }
            .padding()
        }
        .leaseBottomClearance()
        .background(Color(.systemGroupedBackground))
        .onChange(of: isConfirmingRemove) { _, isConfirming in
            // The question shows where the button was; bring all of it above the tab bar.
            guard isConfirming else { return }
            withAnimation { proxy.scrollTo(Self.removeCardID, anchor: .bottom) }
        }
        .onAppear {
            // Back from a finding: show its row again, not the top of the list.
            if let returnToFindingID { proxy.scrollTo(LeaseFindingsSection.rowID(returnToFindingID), anchor: .center) }
        }
        }
    }

    private static let removeCardID = "lease.removeCard"

    @ViewBuilder
    private var status: some View {
        if scan.isReviewed {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Personal details hidden")
                        .font(.headline)
                    Text("Only the text with them hidden is sent when you check your lease.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(.green)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.status")
        } else {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Check what's hidden")
                        .font(.headline)
                    Text("Look over the names, addresses, and numbers FinePrint will hide before your lease leaves this phone.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "eye.slash")
                    .foregroundStyle(.orange)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.status")
        }
    }

    private var readFrom: LocalizedStringResource {
        let ocr = scan.pages.count { $0.method == .ocr }
        let layer = scan.pages.count - ocr
        if ocr == 0 { return "The PDF's text" }
        if layer == 0 { return scan.source == .scan ? "Scanned pages" : "Text recognition" }
        return "\(layer) by PDF text, \(ocr) by text recognition"
    }
}

/// What the Lease tab shows in place of the summary. Each one is swapped in, never pushed or
/// presented (see `LeaseView`).
enum LeaseScreen: Hashable {
    case summary
    /// What Gets Sent.
    case sent
    case finding(String)
    /// The clause explorer, starting at a quote.
    case explorer(focus: TextSpan?)
}

#Preview {
    NavigationStack { LeaseView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
        .environment(AuthSession.preview())
        .environment(UserSettings())
        .modelContainer(for: [Rental.self, Deadline.self], inMemory: true)
}
