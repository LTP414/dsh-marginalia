# Changelog

## 0.2.1 — 2026-11-03

- Fix DSH dark-theme history panel: the send labels were white on a near-white
  `brand-primary` fill (Firefox dark mode made this most visible). They now use
  the theme's `label-primary-foreground` against `button-info-fill`, keep
  `opacity: 1` when disabled, and reserve their intrinsic width.
- The follow-up composer is now pinned to the bottom of the right pane while the
  turn transcript scrolls independently, instead of being overlapped by later
  turns.
- Add Firefox and dark-theme Playwright projects. The dark regression spec
  asserts button visibility/contrast, an opaque panel, a scrolling turn list,
  and a follow-up form that stays below it.
- CI installs Firefox alongside Chromium; 16 browser tests pass (2 nightly
  real-provider cases skipped).

## 0.2.0 — 2026-11-02

- Real-browser end-to-end suite: isolated `DSH_HOME`/profile per worker, real launch-token auth,
  preseeded workspace, deterministic fake LLM, non-loopback plain-HTTP origin, trace/screenshot on
  failure.
- Seven browser specs: slash menu + streaming, Stop/partial history, follow-up, reload persistence,
  read-only tool denial with an untouched file, insert-to-composer, and the insecure-origin UUID
  path. A real-provider nightly spec is gated and skipped by default.
- Suppress the internal command lifecycle pair (`command/run` / `command/done`), so side questions
  no longer add Chat nodes or copy `btw-get` JSON into the session log.
- Filter inherited fork turns from the streaming bubble using the Host's `baselineTurn`.
- Add insert-to-composer as the safe replacement for the unavailable branch operation.
- Unit suite grows to 53 tests; built-artifact smoke remains part of `npm run check`.

## 0.1.0 — 2026-10-28

First usable release.

### Fixed in 0.1.1

- Plain-HTTP Web GUI origins no longer fail with `globalThis.crypto.randomUUID is not a function`; IDs use `getRandomValues` when `randomUUID` is unavailable (secure-context restriction).
- Added a built-artifact smoke test and an insecure-origin client apply test.

### 0.1.0

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
- Tooling: TypeScript typecheck, 45 Vitest tests, built-artifact smoke, self-contained esbuild bundles, CI workflow.

