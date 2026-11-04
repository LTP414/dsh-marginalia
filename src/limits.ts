/**
 * Shared limits. These are deliberately generous but bounded: a side question
 * inherits the whole parent context, so an unbounded answer or replayed topic
 * would grow every later request without the user seeing it.
 */
export const MAX_QUESTION_LENGTH = 8_000
export const MAX_REFERENCE_LENGTH = 8_000
export const MAX_HISTORY_CHARS = 64_000
export const MAX_ANSWER_BYTES = 256 * 1024
export const MAX_ERROR_CHARS = 400
export const MAX_TITLE_CHARS = 80
export const MAX_PARENT_PARTIAL_CHARS = 8_000
/** Compact snapshot of the parent's still-open turn; this is new prompt text. */
export const MAX_PARENT_PROGRESS_CHARS = 6_000
export const MAX_TOPICS_PER_SESSION = 50
export const MAX_TURNS_PER_TOPIC = 200
export const MAX_ACTIVE_BTW = 4
export const MAX_PROMPT_BYTES = 1024 * 1024

/** Hard ceiling for one detached side-question turn (10 minutes). */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000
/** Cleanup must not hang the host teardown path. */
export const CLEANUP_TIMEOUT_MS = 5_000
/** Side answers do not need the parent turn's full completion budget. */
export const MAX_SIDE_OUTPUT_TOKENS = 32_000
