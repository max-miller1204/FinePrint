import SwiftUI

/// What to show in the room picker, which `RootTabView` presents (see `AppNavigation.roomPicker`).
struct RoomPickerRequest: Identifiable {
    let id = UUID()
    var title: LocalizedStringResource
    var confirmTitle: LocalizedStringResource
    var existingNames: [String] = []
    var onConfirm: ([WalkthroughRoom]) -> Void
}

/// Choose rooms: the presets in one tap each, plus rooms the tenant names (spec §4.3 F2).
/// Used to start a walkthrough and to add rooms to one in progress.
struct RoomPickerSheet: View {
    let title: LocalizedStringResource
    let confirmTitle: LocalizedStringResource
    /// Names already in the walkthrough, which cannot be added twice.
    let existingNames: [String]
    let onConfirm: ([WalkthroughRoom]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var presets: Set<RoomPreset> = []
    @State private var customNames: [String] = []
    @State private var draft = ""
    @FocusState private var isFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(RoomPreset.allCases) { preset in
                        presetRow(preset)
                    }
                } header: {
                    Text("Rooms")
                } footer: {
                    Text("Each room gets a checklist: walls, floor, ceiling, windows, doors, outlets and switches, and fixtures.")
                }

                Section {
                    ForEach(customNames, id: \.self) { name in
                        HStack(spacing: 12) {
                            Text(verbatim: name)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button {
                                customNames.removeAll { $0 == name }
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(Text("Remove \(name)"))
                        }
                    }
                    TextField("Room name", text: $draft, prompt: Text("Room name"))
                        .submitLabel(.done)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)
                        .focused($isFieldFocused)
                        .onSubmit(addDraft)
                        .onChange(of: draft) { _, text in
                            if text.count > RoomName.maxLength { draft = String(text.prefix(RoomName.maxLength)) }
                        }
                        .accessibilityIdentifier("walkthrough.customRoomField")
                    if draftIsTaken, let name = RoomName.cleaned(draft) {
                        Label {
                            Text("You already have a room called \(name).")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        .font(.footnote)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("walkthrough.customRoomError")
                    }
                    Button("Add Room", action: addDraft)
                        .disabled(RoomName.cleaned(draft) == nil || draftIsTaken)
                        .accessibilityIdentifier("walkthrough.addCustomRoom")
                } header: {
                    Text("Your Own Rooms")
                } footer: {
                    Text("Name any other space you want to photograph, such as a garage or a porch.")
                }

                Section { confirmRow } footer: { Text(summary) }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("walkthrough.rooms.cancel")
                }
            }
        }
        .presentationDetents([.large])
    }

    private func presetRow(_ preset: RoomPreset) -> some View {
        let isAdded = existingNames.contains { RoomName.matches($0, preset.title) }
        let isSelected = presets.contains(preset)
        return Button {
            if isSelected { presets.remove(preset) } else { presets.insert(preset) }
        } label: {
            HStack(spacing: 12) {
                Label {
                    Text(verbatim: preset.title)
                        .foregroundStyle(.primary)
                } icon: {
                    Image(systemName: preset.systemImage)
                }
                Spacer(minLength: 8)
                if isAdded {
                    Text("Added")
                        .foregroundStyle(.secondary)
                } else {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .disabled(isAdded)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("walkthrough.room.\(preset.rawValue)")
    }

    private var confirmRow: some View {
        Button {
            addDraft()
            onConfirm(makeRooms())
            dismiss()
        } label: {
            Text(confirmTitle).frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(selectedCount == 0)
        .keyboardShortcut(.defaultAction)
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        .accessibilityIdentifier("walkthrough.rooms.confirm")
    }

    private var selectedCount: Int {
        presets.count + customNames.count + (RoomName.cleaned(draft) == nil || draftIsTaken ? 0 : 1)
    }

    /// The typed name is already a room here or in the walkthrough. Shown as you type, so there is
    /// no tap to find out.
    private var draftIsTaken: Bool {
        guard let name = RoomName.cleaned(draft) else { return false }
        return (existingNames + RoomPreset.allCases.map(\.title) + customNames).contains { RoomName.matches($0, name) }
    }

    private var summary: LocalizedStringResource {
        selectedCount == 0 ? "Pick at least one room." : "\(selectedCount) selected"
    }

    /// Presets in list order, then the tenant's own rooms in the order they were added.
    private func makeRooms() -> [WalkthroughRoom] {
        RoomPreset.allCases.filter { presets.contains($0) }.map { WalkthroughRoom($0) }
            + customNames.map { WalkthroughRoom(name: $0) }
    }

    private func addDraft() {
        guard let name = RoomName.cleaned(draft), !draftIsTaken else { return }
        customNames.append(name)
        draft = ""
        // Closes the keyboard so the Start button below is not hidden behind it.
        isFieldFocused = false
    }
}

#Preview {
    RoomPickerSheet(title: "Choose Rooms", confirmTitle: "Start Walkthrough", existingNames: ["Kitchen"]) { _ in }
}
