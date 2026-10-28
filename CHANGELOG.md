# Changelog

## 0.1.0 — 2026-10-28

First usable release.

- Host: fork-based read-only side-question engine with a reserved child id, monotonic tool guard,
  one active job per parent, timeout, cancellation, and cleanup.
- Host: durable topics in the `marginalia` storage domain; crash-left `running` turns become
  `interrupted`; hidden authenticated command transport.
- Prompt: same system/tool prefix, `<btw>` user-turn instructions, topic history replay, parent
  in-flight partial text, open-tool names, fenced quoted context.
- Client: `/btw` input-trigger source, streaming bubble at `conversation.input.overlay`,
  follow-up, cancel with partial preservation, copy/collapse/close.
- Client: topic history at `shell.overlay` with list/detail, retry, delete, copy, follow-up, and a
  composer toolbar entry point.
- Tooling: TypeScript typecheck, 50 Vitest tests, built-artifact smoke, self-contained esbuild bundles, CI workflow.

### Fixed in the same release

- Plain-HTTP Web GUI origins no longer fail with `globalThis.crypto.randomUUID is not a function`; IDs use `getRandomValues` when `randomUUID` is unavailable (secure-context restriction).
