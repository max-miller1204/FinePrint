import CryptoKit
import Foundation

/// SHA-256 of evidence bytes, as the lowercase hex the server checks on upload (spec §8.2).
nonisolated enum EvidenceHash {
    static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
