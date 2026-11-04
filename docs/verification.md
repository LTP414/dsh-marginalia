# Verification

## Automated

```bash
npm run check          # typecheck + 58 unit tests + build + built-artifact smoke
npm run test:coverage  # the same unit suite with a coverage report
npm run test:e2e       # 16 browser tests (Chromium/Firefox × light/dark), 2 nightly skips
```

Results on 2026-11-04 (DSH CLI `0.2.1-rc.2`, frontend `0.2.1-rc.5`, Node 24.22.1, Playwright Chromium + Firefox 157):

- `tsc --noEmit`: clean.
- Vitest: **11 files, 58 tests passed**.
- Build: self-contained Host ESM, browser CommonJS module, declarations.
- `npm run smoke`: built Host import, built Client module-loader load, built Client `apply()` on a
  simulated plain-HTTP origin without `crypto.randomUUID`.
- Playwright: **18 passed, 2 skipped** against isolated Hosts bound to `10.10.0.2` (plain HTTP):
  Chromium/Firefox × light/dark; the two skips are the gated real-provider spec in the light projects.
- `npm run test:coverage`: 68.71% statements, 69.5% branches, 76.19% functions, 68.71% lines.
  The browser-rendered components (`Bubble.tsx`, `HistoryOverlay.tsx`, `Markdown.tsx`) are near 0%
  in Node coverage because they need a DOM; the Playwright suite covers them end to end.
- Bundle installation in the `web` profile: `application: applied`.
- Live Client slots: `conversation.input.overlay` → `dsh-marginalia-bubbles`,
  `shell.overlay` → `dsh-marginalia-history`, `conversation.input.left` →
  `dsh-marginalia-history-button`, plus five hidden command-view keys.

## Browser suite (real GUI, deterministic model)

See [`e2e.md`](e2e.md) for the harness. Each worker gets its own `DSH_HOME`, profile, port,
workspace, and storage; auth uses the real launch-token exchange.

| Spec | Result |
| --- | --- |
| `/btw` appears in the real slash menu, claim, token growth, no inherited parent text, main Chat node count unchanged, child archived in workspace storage (Chromium + Firefox) | pass |
| First-turn `/btw` sees the open main task while the main turn is still running (Chromium + Firefox) | pass |
| Stop keeps the partial answer; history row is Cancelled | pass |
| Follow-up creates a second turn in the same topic | pass |
| Reload restores the same session and history, recreates no bubble, resends nothing | pass |
| Forced `bash` tool call is denied, target file untouched, transcript unchanged | pass |
| Insert answer into composer without sending | pass |
| Plain-HTTP origin with `crypto.randomUUID === undefined` still asks successfully (Chromium + Firefox) | pass |
| Dark DSH theme: send labels visible, panel opaque, turns scroll, follow-up pinned (Chromium + Firefox) | pass |
| Real provider acceptance | skipped unless `DSH_E2E_REAL=1` + `DEEPSEEK_API_KEY` |

## Unit and wiring coverage

| Area | File | Assertions |
| --- | --- | --- |
| Protocol and prompt | `tests/shared.test.ts` | normalization/rejection, hidden command line, `<btw>` shape, history budget, quote fencing, open-turn progress/partial/open-tool sections, artifact sanitization, UTF-8 truncation, summaries |
| Open-turn snapshot | `tests/parent-context.test.ts` | first-turn task, tool call/result, injected-context filtering, cap/escaping, closed-turn boundary |
| Guard | `tests/tool-guard.test.ts` | owned-only deny, child-scope attach once, release, failure containment |
| Storage | `tests/store.test.ts` | parent isolation, ordering, per-key serialization, crash repair, memory fallback, delete |
| Engine | `tests/engine.test.ts` | early accept, prompt contents, follow-up replay, busy refusal, cancel with partial, timeout, archive hook, unload interruption |
| Random IDs | `tests/random.test.ts` | `randomUUID` path, `getRandomValues` path, throwing `randomUUID`, no-crypto fallback, v4 shape/uniqueness |
| Client apply | `tests/client-apply.test.ts` | real `apply()` wiring on insecure origin; `/btw` claim reaches the Host bridge |
| Client store | `tests/client-store.test.ts` | streaming, inherited-turn filtering, canonical finalize, host rejection, local busy, history open/select/delete, dismiss-before-accept, subagent refusal |
| Trigger | `tests/trigger.test.ts` | candidate visibility, claim on space/enter, argument routing, attachment refusal, subagent refusal |
| Commands/wiring | `tests/commands.test.ts`, `tests/host-wiring.test.ts` | hidden list patch, lifecycle quieting, restore, JSON results, error containment, real `apply()` assembly |

## Remaining gaps

- **Native Remote transport.** Internal commands are hidden and quiet, but still use
  `commands.execute`. The lifecycle shim depends on `CommandRuntime.appendLifecycle`; a future DSH
  may remove it.
- **Subagent view browser coverage.** Unit tests cover the refusal/hidden toolbar, but navigating
  into a live delegated child in the GUI is not automated.
- **True ephemerality.** The side child is a durable Session; the archive record is asserted, but
  the Host cannot delete the child log.
- **Real-provider variance.** The nightly spec is gated; CI deterministic coverage uses the fake
  model.
- **Branch.** DSH still has no public assistant-injection/branch API. Insert-to-composer is the
  supported replacement, and it is browser-tested.

## Manual checklist (optional residual checks)

- [ ] A second `/btw` while the first runs reports busy.
- [ ] Bare `/btw` opens history; `Esc` closes it.
- [ ] A question containing `</btw>` or a code fence renders safely.
- [ ] An answer containing HTML or a remote image does not execute/load it.
- [ ] A delegated-subagent view hides `/btw` and the toolbar button.
- [ ] Plugin unload leaves no timer, listener, guard, or child behind.

## Cache-prefix note

The engine never touches system/tools/messages; the only prompt addition is one user turn. Unit
tests pin the prompt and activation request shape, and the browser suite proves the user-visible
behavior. They still cannot prove a provider-side cache hit; the honest claim is "does not
actively break the prefix", not "always hits".
