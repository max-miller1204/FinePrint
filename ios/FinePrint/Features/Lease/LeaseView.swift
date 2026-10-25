import SwiftData
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// The Lease tab (spec §4.3 F1): scan or import the current rental's lease, read it on the phone,
/// and review what is hidden before anything is sent.
///
/// Nothing here is presented from inside the tab: the review is pushed, questions are inline rows,
/// and the file picker and document camera are `SystemPicker`s that `RootTabView` presents. A sheet,
/// alert, or dialog from inside a tab while the deadline accessory shows sends SwiftUI into an
/// AttributeGraph update cycle whenever accessibility is on (VoiceOver, UI automation).
struct LeaseView: View {
    @Environment(\.leaseStore) private var store
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AppNavigation.self) private var navigation
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]
    @State private var model = LeaseModel()
    @State private var isScannerUnavailable = false

    private var currentRentalID: UUID? { Rental.current(in: rentals)?.id }

    var body: some View {
        @Bindable var model = model
        content
            .background(Color(.systemBackground))
            .navigationTitle("Lease")
            .rentalSubtitle()
            .settingsToolbar()
            .rentalSwitcher()
            .task(id: currentRentalID) {
                await model.load(rentalID: currentRentalID, store: store)
            }
            .onChange(of: navigation.systemPickerResult?.id) {
                guard let result = navigation.systemPickerResult, navigation.selectedTab == .lease else { return }
                navigation.systemPickerResult = nil
                switch result.content {
                case .file(let url): model.importPDF(at: url, store: store)
                case .scan(let images): model.importScan(images, store: store)
                }
            }
            .navigationDestination(item: $model.reviewing) { scan in
                RedactionReviewView(scan: scan) { reviewed in
                    Task { await model.finishReview(reviewed, store: store) }
                }
            }
    }

    @ViewBuilder
    private var content: some View {
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
            LeaseSummaryView(scan: scan) {
                model.reviewing = scan
            } onRemove: {
                Task { await model.removeLease(store: store) }
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

/// The current rental's lease once it has been read: what was read, what is hidden, and what
/// would be sent.
struct LeaseSummaryView: View {
    let scan: LeaseScan
    let onReview: () -> Void
    let onRemove: () -> Void
    @State private var isConfirmingRemove = false

    var body: some View {
        List {
            Section {
                if scan.isReviewed {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Personal details hidden")
                                .font(.headline)
                            Text("Only the text with them hidden will be sent. Checking it against Virginia law is the next step and isn't available yet.")
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
                Button(action: onReview) {
                    Label("Review Hidden Details", systemImage: "list.bullet.rectangle")
                }
                .accessibilityIdentifier("lease.review")
                NavigationLink {
                    LeaseSentTextView(scan: scan)
                } label: {
                    Label("See What Gets Sent", systemImage: "paperplane")
                }
                .disabled(!scan.isReviewed)
                .accessibilityIdentifier("lease.sentPreview")
            }

            Section("Your Lease") {
                LabeledContent("Pages") {
                    Text(scan.pages.count, format: .number)
                }
                LabeledContent("Read From") {
                    Text(readFrom)
                }
                LabeledContent("Hidden Details") {
                    Text(scan.redactions.hiddenCount, format: .number)
                }
                .accessibilityIdentifier("lease.hiddenCount")
            }

            Section {
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
                        .accessibilityIdentifier("lease.remove.confirm")
                    Button("Keep Lease") { isConfirmingRemove = false }
                        .accessibilityIdentifier("lease.remove.cancel")
                } else {
                    Button("Remove Lease", role: .destructive) {
                        isConfirmingRemove = true
                        AccessibilityNotification.Announcement(String(localized: "Remove this lease from your phone? Choose Remove Lease or Keep Lease.")).post()
                    }
                    .accessibilityIdentifier("lease.remove")
                }
            } footer: {
                Text("Your scan, its full text, and the hidden details stay on this phone.")
            }

            Section {
                LegalFooter()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
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

#Preview {
    NavigationStack { LeaseView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
        .modelContainer(for: [Rental.self, Deadline.self], inMemory: true)
}
