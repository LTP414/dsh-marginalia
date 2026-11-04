# Browser end-to-end suite

This suite is the answer to the verification gap: it drives the **real Web GUI** in Chromium
against a **real isolated DSH Host**, with a deterministic fake model. It does not touch the user's
`web` profile.

## What is real

| Part | Real? | How |
| --- | --- | --- |
| Web GUI | yes | Chromium via Playwright, real DOM and Lexical composer |
| Host | yes | `dsh --profile e2e` with its own `DSH_HOME`, port, storage, and workspace |
| Auth | yes | the launch URL's process token is exchanged for the signed `dsh-auth-*` cookie |
| Fork / child session / tool guard | yes | the plugin runs its normal Host path |
| Model | fake | a test bundle registering the `fake` provider |
| Browsers | Chromium + Firefox | four projects: light/dark × chromium/firefox |
| Persistence | yes | real `storage-domain` JSON backend in the isolated home |

## Isolation

`e2e/support/host.ts` creates one run directory per worker:

```
.e2e-runs/host-XXXX/
  profiles/e2e/          # custom profile initialized from the shipped web template
  workspace/             # visible test workspace, preseeded in workspace.json
  storages/              # marginalia + workspace domains
  sessions/              # real session logs
  host.log
```

`DSH_HOME`, `XDG_*`, and the pnpm cache all point inside it. The plugin under test and the fake LLM
are added with `dsh plugin --profile e2e add <local-link>`; no registry package is used. Nothing
reads or writes `~/.dsh/profiles/web`.

## Auth

The Host prints:

```
dsh web: http://<bind-ip>:<port>/?token=<process-token>
```

`openApp()` navigates to that URL. The Host redirects to `/`, sets the signed session cookie, and
every API/WebSocket call uses it. There is no test mode that disables authentication and no faked
owner peer. Reusing the token is not needed: reloads use the cookie.

## Non-secure origin

The Host binds the first non-loopback IPv4 interface by default (`10.10.0.2` here), and Playwright
navigates to that HTTP address. Chromium therefore reports
`typeof crypto.randomUUID === 'undefined'`, which is the exact condition that caused the original
failure. Set `DSH_E2E_BIND_HOST=127.0.0.1` only when you intentionally want a secure-context run;
the non-secure spec then skips.

## Deterministic model

`e2e/fixtures/fake-llm` registers a duck-typed `LlmAdapter`:

- `listModels` / `resolveModel` advertise `fake/fake-1` so the GUI model picker accepts it.
- Tokens are emitted as real `text-delta` chunks. `[slow]` selects a 110 ms inter-token delay.
- `[hold]` delays the main first-turn answer so `/btw` can run before `turn/end`.
- `[context]` echoes the received `<parent-in-progress>` block, proving the open-turn snapshot reached the child.
- `[tool]` emits a real `bash touch <path>` tool-call block; the Host's execution guard must deny
  it and the test asserts the file does not exist.
- A tool-result step is answered with the guard message.
- Abort yields a terminal `aborted` finish.
- Session-title calls get `E2E Session`.

The profile patch overrides `agent-default-model` to `fake/fake-1`. No credentials and no network
model calls are involved.

## Workspace seed

Rather than driving the native directory picker, the fixture writes a valid `workspace.json`
domain record before launch. The GUI opens the workspace with a blank session. Tests click
**New Session** only if needed; in practice a fresh browser context opens a blank session.

## Specs

| Spec | Proves |
| --- | --- |
| `/btw` menu + streaming | candidate appears in the real slash menu; claim works; answer length grows; inherited parent turns are not shown; main Chat node count is unchanged |
| First-turn context | while the main first turn is still running, `/btw` receives the current user task in `<parent-in-progress>` and answers from it |
| Stop + history | Stop preserves partial text; history status is Cancelled; the partial survives into the history panel |
| Follow-up | a second turn lands in the same topic and history shows 2 turns |
| Reload | the same session restores; history still has the answer; no bubble is recreated or resent |
| Tool guard | a forced `bash` call is denied; the target file is untouched; transcript unchanged |
| Insert | the answer can be placed into the composer without sending it |
| Insecure origin | `crypto.randomUUID` is undefined and `/btw` still works |
| Dark theme history | send labels remain visible; panel is opaque; turns scroll independently; follow-up stays pinned |
| Real nightly | skipped unless explicitly enabled; runs the same browser path against the configured real provider |

## Running

```bash
npm run test:e2e
# or a single spec
npx playwright test -g "Stop keeps"
```

Requirements:

- `dsh` on `PATH` (`DSH_BIN` overrides), matching the plugin's engine range
- `pnpm` on `PATH` (the Host's plugin add uses it)
- Playwright Chromium + Firefox. The config auto-detects `~/.cache/ms-playwright` and the repo-local
  `.playwright-browsers/`; otherwise run `npx playwright install chromium firefox`.

Artifacts: trace and screenshot on failure under `.e2e-runs/artifacts`; video is off because it
requires the matching Playwright ffmpeg build. Each worker leaves its host log and storage under
`.e2e-runs/host-*` for diagnosis.

## README screenshots

```bash
npm run screenshots
```

`E2E_SCREENSHOTS=1` adds a `screens` project that captures `docs/assets/screenshots/`:
`btw-menu.png`, `btw-streaming.png`, `btw-history.png`, `btw-history-dark.png`. It uses a demo
profile response and disables CSS animations for stable captures. It is not part of the normal
test matrix.

## Browsers and themes

Four projects:

| Project | Specs | Theme |
| --- | --- | --- |
| `chromium` | `btw.spec.ts` | DSH light (profile patch) |
| `firefox` | `btw.spec.ts` | DSH light |
| `chromium-dark` | `history-theme.spec.ts` | DSH dark (`ui-theme.preference=dark`) |
| `firefox-dark` | `history-theme.spec.ts` | DSH dark |

The full matrix is **18 passed + 2 skipped** (the real-provider spec in the two light projects).
The theme is not simulated with `colorScheme`; the fixture writes the real `ui-theme` profile patch.
The dark regression asserts button label contrast (the old white-on-white `brand-primary` fill),
opacity 1 for disabled buttons, an opaque panel, a scrolling turn list, and a follow-up form that
stays below it. `Firefox + DSH dark` is the original failure combination.

## Real-provider nightly

```bash
DSH_E2E_REAL=1 DEEPSEEK_API_KEY=... npm run test:e2e:real
```

It launches a separate Host without the fake bundle, sets `agent-default-model` to
`deepseek-official/deepseek-flash` (override with `DSH_E2E_REAL_PROVIDER` / `DSH_E2E_REAL_MODEL`),
seeds one exchange, asks a side question, and requires a non-empty answer. It is skipped by the
deterministic suite. Keep it out of every-push CI and run it before a release.

## Why the fake model is not cheating

The model is only the token source. Everything under test — the slash menu, claim, fork, child
retention, streaming, cancellation, storage, guard, reload — is exercised as in production. A real
provider adds network and model variance, not a different plugin path; the nightly spec covers that
last mile.

## Not covered

- Opening a live delegated-subagent session view and asserting the hidden `/btw` entry there.
  Unit tests cover the capability check; the GUI navigation is not automated.
- Multi-tab concurrent editing of the same session.
- Real provider variance in CI (nightly only).
