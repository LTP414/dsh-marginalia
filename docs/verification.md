# Verification

## Automated

Run from the repository root:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # esbuild host + client, tsc declarations
```

Results on 2026-10-28 (DSH 0.2.1-rc.2, Node 24.22.1):

- `tsc --noEmit`: clean.
- Vitest: **8 files, 45 tests passed**.
- Build: `lib/index.js` (self-contained Host ESM), `lib/client.js` (browser CommonJS module),
  `lib/types/**` declarations.
- Client bundle smoke load with a `__ModuleLoader__` stub and DOM shim: exports
  `{ apply, inject, name }`.
- Bundle installation in the `web` profile: `application: applied`.
- Live Client slot inspection after installation:
  - `conversation.input.overlay` → `dsh-marginalia-bubbles`
  - `shell.overlay` → `dsh-marginalia-history`
  - `conversation.input.left` → `dsh-marginalia-history-button`

## What the tests cover

| Area | File | Assertions |
| --- | --- | --- |
| Protocol and prompt | `tests/shared.test.ts` | normalization/rejection, hidden command line, `<btw>` shape, history budget, quote fencing, partial/open-tool sections, artifact sanitization, UTF-8 truncation, summaries |
| Guard | `tests/tool-guard.test.ts` | owned-only deny, child-scope attach once, release, failure containment |
| Storage | `tests/store.test.ts` | parent isolation, ordering, per-key serialization, crash repair, memory fallback, delete |
| Engine | `tests/engine.test.ts` | early accept, prompt contents, follow-up replay, busy refusal, cancel with partial, timeout, archive hook, unload interruption |
| Client store | `tests/client-store.test.ts` | streaming, canonical finalize, host rejection, local busy, history open/select/delete, dismiss-before-accept, subagent refusal |
| Trigger | `tests/trigger.test.ts` | candidate visibility, claim on space/enter, argument routing, attachment refusal, subagent refusal |
| Commands/wiring | `tests/commands.test.ts`, `tests/host-wiring.test.ts` | hidden list patch + restore, JSON results, error containment, real `apply()` assembly with fake Host services |

## Not yet exercised

These require a live browser session and a real model, which this environment does not provide:

1. Typing `/btw` in the actual composer and seeing the menu row.
2. Streaming a real fork answer into the bubble.
3. Clicking stop and confirming the partial answer appears in history.
4. Reloading the page and reopening history.
5. Verifying `workspaceRegistry.archiveSession(childId)` on a real subagent child
   (the code logs and continues if the Host refuses).

The browser UI was registered successfully, but registration alone is not visual proof. Please run
the manual checklist below in the Web GUI.

## Manual checklist

- [ ] `/btw 刚才为什么选方案 B？` shows one bubble; the main transcript only gains hidden command
      lifecycle events, not user/assistant messages.
- [ ] The bubble text appears token by token (or at least before completion).
- [ ] The stop button keeps the partial text and the history row says Cancelled.
- [ ] A second `/btw` while the first runs reports busy.
- [ ] Bare `/btw` opens the history panel; `Esc` closes it.
- [ ] Follow-up from a bubble adds a second turn under the same topic.
- [ ] Reload → history still lists both turns; no turn automatically re-runs.
- [ ] A question containing `</btw>` or a code fence still renders.
- [ ] An answer containing HTML or a remote image does not execute/load it.
- [ ] The side child cannot call a tool (validate with a prompt that tries to force one).
- [ ] Plugin unload leaves no timer, listener, guard, or child behind.

## Cache-prefix note

The engine never touches system/tools/messages; the only prompt addition is one user turn. The
unit tests pin the constructed prompt and the activation request shape, but they cannot prove a
provider-side cache hit. The honest claim is "does not actively break the prefix", not "always
hits".
