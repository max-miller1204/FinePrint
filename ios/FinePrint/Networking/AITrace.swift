import Foundation

/// One model call the server made for a request (#39): which Gemma model ran which stage, how long
/// it took, and its token counts. The server sends no prompts or answers in it.
nonisolated struct AITraceStep: Codable, Equatable, Sendable {
    /// The pipeline stage, such as `responsibility` or `responsibility_verify`.
    var stage: String
    /// The model ID, such as `gemma-4-26b-a4b-it`.
    var model: String
    /// The whole call, rate-limit waits and retries included.
    var ms: Int
    var inputTokens: Int
    var outputTokens: Int
    /// A later model in the chain answered because the first was unavailable.
    var fallback: Bool
}
