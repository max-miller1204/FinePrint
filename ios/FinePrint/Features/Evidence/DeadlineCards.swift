import SwiftUI
import UIKit

/// One clock: what it is, when it ends, what the tenant can do, and its reminders.
/// Content sits on a solid background; glass stays on the navigation layer.
struct DeadlineCard: View {
    let deadline: Deadline
    @Environment(DeadlineStore.self) private var deadlines
    @State private var isReportSheetPresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Text(explanation)
                .fixedSize(horizontal: false, vertical: true)
            if deadline.kind == .depositItemization {
                DepositChecklist()
            }
            Text(verbatim: deadline.kind.citation)
                .font(.footnote)
                .foregroundStyle(.secondary)
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("deadline.card.\(deadline.kind.rawValue)")
        .sheet(isPresented: $isReportSheetPresented) {
            if let rental = deadline.rental {
                DayEntrySheet(
                    title: "Landlord's Report",
                    dateLabel: "Date you got it",
                    footer: "You have 5 days after this date to object in writing. FinePrint counts the days for you.",
                    allowsFutureDates: false
                ) { day in
                    await deadlines.recordReportReceived(on: day, for: rental)
                }
            }
        }
    }

    private var countdown: NextDeadline.Countdown {
        DeadlineStore.snapshot(deadline).countdown(from: .now)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(deadline.kind.title)
                .font(.headline)
            Text("Due \(deadline.dueDay.formatted(.dateTime.weekday(.wide).month(.wide).day()))")
                .foregroundStyle(.secondary)
            Text(countdown.text)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(countdown == .pastDue ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary))
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var explanation: LocalizedStringResource {
        switch (deadline.kind, countdown) {
        case (.moveInReport, .pastDue):
            "Your landlord's written report of existing damage is late. Your own dated photos are a written record you can send."
        case (.moveInReport, _):
            "Virginia law says your landlord must give you a written report of existing damage within 5 days after you move in. When it comes, you have 5 days to object in writing."
        case (.objection, _):
            "If you do not object in writing within 5 days after you get the report, the report counts as correct. Compare it with your photos and list anything it leaves out."
        case (.depositItemization, _):
            "Virginia law says your landlord must return your deposit, or list any deductions in writing, within 45 days after your tenancy ends."
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(alignment: .leading, spacing: 12) {
            if deadline.kind == .moveInReport, deadline.rental != nil {
                Button("I Got the Report") { isReportSheetPresented = true }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("deadline.reportReceived")
            }
            ReminderControl(reminderDays: deadlines.reminderDays(for: deadline))
        }
    }
}

/// The deposit tracker's two reminders (spec §4.3 F6, Va. Code § 55.1-1226).
private struct DepositChecklist: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Each label is one accessibility element, so VoiceOver reads it once and tests see one node.
            Label("Give your landlord your forwarding address in writing, so the deposit and the list of deductions reach you.", systemImage: "envelope")
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("deposit.forwardingAddress")
            Label("You have the right to be there for the move-out inspection. Ask your landlord in writing.", systemImage: "person.2")
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("deposit.inspection")
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Remind Me, or the state of reminders once the tenant has answered the permission prompt.
private struct ReminderControl: View {
    let reminderDays: [CalendarDay]
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(\.openURL) private var openURL
    @State private var isRequesting = false

    var body: some View {
        switch deadlines.authorization {
        case .authorized:
            if let first = upcomingDays.first, let last = upcomingDays.last {
                Label {
                    Text(first == last
                         ? "Reminder at 9 a.m. on \(first.formatted(.dateTime.month(.wide).day()))"
                         : "Reminders at 9 a.m. on \(first.formatted(.dateTime.month(.wide).day())) and \(last.formatted(.dateTime.month(.wide).day()))")
                } icon: {
                    Image(systemName: "bell")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("deadline.remindersOn")
            }
        case .denied:
            VStack(alignment: .leading, spacing: 8) {
                Text("Notifications are off for FinePrint, so there are no reminders.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
                .accessibilityIdentifier("deadline.openSettings")
            }
        case .notDetermined, nil:
            Button {
                isRequesting = true
                Task {
                    await deadlines.requestReminders()
                    isRequesting = false
                }
            } label: {
                Label("Remind Me", systemImage: "bell")
            }
            .buttonStyle(.bordered)
            .disabled(isRequesting)
            .accessibilityHint(Text("Sends a reminder at 9 a.m. on the 2 days before it is due"))
            .accessibilityIdentifier("deadline.remindMe")
        }
    }

    private var upcomingDays: [CalendarDay] {
        reminderDays.filter { deadlines.today.days(until: $0) >= 0 }
    }
}

/// Shown while moving out with no end date yet, so the 45-day clock can start.
struct MoveOutDateCard: View {
    let rental: Rental
    @Environment(DeadlineStore.self) private var deadlines
    @State private var isSheetPresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Deposit Tracker")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("Add the day your tenancy ends. Virginia law gives your landlord 45 days after that to return your deposit or list deductions in writing.")
                .fixedSize(horizontal: false, vertical: true)
            DepositChecklist()
            Button("Add Move-Out Date") { isSheetPresented = true }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("deposit.addMoveOutDate")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("deposit.moveOutCard")
        .sheet(isPresented: $isSheetPresented) {
            DayEntrySheet(
                title: "Move-Out Date",
                dateLabel: "Tenancy ends",
                footer: "FinePrint counts 45 days from this date and can remind you before it ends.",
                allowsFutureDates: true
            ) { day in
                await deadlines.setTenancyEnd(day, for: rental)
            }
        }
    }
}

/// Picks one calendar day and starts a clock from it.
private struct DayEntrySheet: View {
    let title: LocalizedStringResource
    let dateLabel: LocalizedStringResource
    let footer: LocalizedStringResource
    let allowsFutureDates: Bool
    let onSave: (CalendarDay) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date.now
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if allowsFutureDates {
                        DatePicker(selection: $date, displayedComponents: .date) { Text(dateLabel) }
                    } else {
                        DatePicker(selection: $date, in: ...Date.now, displayedComponents: .date) { Text(dateLabel) }
                    }
                } footer: {
                    Text(footer)
                }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("dayEntry.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start Clock") {
                        isSaving = true
                        Task {
                            await onSave(CalendarDay(date))
                            dismiss()
                        }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("dayEntry.save")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

extension CalendarDay {
    /// Formats the day in the device's calendar, for display only.
    func formatted(_ style: Date.FormatStyle) -> String {
        (startOfDay(in: .current) ?? .now).formatted(style)
    }
}
