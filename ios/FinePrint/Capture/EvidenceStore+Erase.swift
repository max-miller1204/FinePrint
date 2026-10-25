import Foundation

extension EvidenceStore {
    /// How many photos are kept on this device: one folder per capture, inside one per rental.
    func captureCount() -> Int {
        let files = FileManager.default
        let rentals = (try? files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return rentals.reduce(0) { total, rental in
            total + ((try? files.contentsOfDirectory(at: rental, includingPropertiesForKeys: nil))?.count ?? 0)
        }
    }

    /// Removes every photo, record, and upload file. "Delete everything" calls it.
    func eraseAll() throws {
        guard FileManager.default.fileExists(atPath: root.path(percentEncoded: false)) else { return }
        try FileManager.default.removeItem(at: root)
    }
}
