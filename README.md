# dsh-marginalia

> Read-only side questions for DeepSeek Harness. Ask in the margin, keep the main thread clean.

`marginalia` (noun): notes written in the margin of a page. That is what `/btw` is in
[oh-my-pi](https://github.com/can1357/oh-my-pi): a note taken beside the main conversation,
without changing it.

This is a DSH Host + Web Client bundle that implements the practical form of that contract:

- **Same conversation** — the side turn forks the current session, so it sees the same system
  prompt, the same tool catalog, and the same completed history.
- **Read-only, enforced** — the inherited tools remain in the request to preserve the prompt
  prefix, but an execution-time guard rejects every tool call. This is not a prompt request.
- **Visible in-flight context** — if the main answer is still streaming when you ask, the captured
  partial text is added to the side prompt as reference-only material.
- **Topics and history** — every question is persisted with its status and answer; follow-ups
  replay the topic and see the parent conversation as it is *now*.
- **Streaming and cancellation** — the Web Client retains the child session, renders its partial
  text, and preserves what was generated when you stop it.
- **No fabricated branch** — DSH has no public "insert an assistant message / create a branch"
  API. Marginalia does not pretend; it offers insert-to-composer in a future version instead.

## Requirements

- DSH `>= 0.2.1-rc.1 < 0.3.0-0` (tested against `0.2.1-rc.2`)
- Node `>= 22`
- Works on a plain-HTTP LAN Web GUI: `crypto.randomUUID` is restricted to secure contexts, so the plugin uses `getRandomValues` (or a non-cryptographic identifier fallback) when needed.
- A composed `fork` subagent provider and `storage-domain` for durable history
  (both are part of the standard Web profile; the plugin falls back to process memory if the
  storage domain is absent)

## Install

From this checkout:

```bash
npm install
npm run check          # typecheck + 50 unit tests + build + smoke
```

Then install the workspace directory as a bundle through the Harness plugin manager, or add it to
a bundle composition:

```yaml
- insert:
    - id: dsh-marginalia
      name: dsh-marginalia
```

The built package is self-contained: the Host half bundles its only runtime dependency (`zod`) and
the Client half bundles its Markdown renderer. React and the Harness packages are supplied by the
Host's module table.

## Use

| Action | How |
| --- | --- |
| Ask beside the current session | `/btw 刚才为什么选方案 B？` |
| Open topic history | `/btw` with no argument, or the Marginalia button at the left of the composer |
| Follow up in the same topic | The send icon on a finished bubble, or the follow-up box in history |
| Stop a running answer | The stop button on the bubble; the partial answer is kept |
| Copy / retry / delete | Buttons on a bubble or a history turn |
| Close the history panel | `Esc`, the close button, or click the backdrop |

`/btw` accepts text only. Images and files stay in the composer and the submission is refused, so
the draft is not silently lost.

## How it works

```
/btw question
  → Client input trigger claims the line
  → Host btw-ask (authenticated command RPC)
      reserve child id → guard the id → fork the parent
      append one user-role <btw> prompt
      persist a running turn
  → Client retains the child session and follows its Chat target
  → Host stream capture keeps partial text; cancellation persists it
  → Host persists complete/cancelled/error; child is archived best-effort
```

The public `/btw` command is contributed by an `inputTriggers` slash source, not by patching the
official command UI. Bubbles use `conversation.input.overlay`; history uses `shell.overlay`; the
toolbar button uses `conversation.input.left`. The only host-side patch is a scoped filter around
`commands.list` that hides the internal transport commands from the slash directory.

See [`docs/architecture.md`](docs/architecture.md) for the full design and
[`docs/verification.md`](docs/verification.md) for what has and has not been exercised.

## Data

- Domain: `marginalia`, table `topics`, key `${parentSessionId}:${topicId}`.
- A turn stores only visible question/answer text and status; reasoning and tool payloads are not
  persisted.
- On startup, `running` turns become `interrupted`; they are never retried automatically.
- Limits: 8k question, 8k quote, 64k replayed topic history, 256 KiB answer, 50 topics/session,
  200 turns/topic, 4 active side questions process-wide, 10 minute watchdog.

The internal commands are `btw-ask`, `btw-list`, `btw-get`, `btw-cancel`, `btw-delete`. They are
hidden from the slash menu but still resolve for the authenticated RPC. Command results are part
of the session's command lifecycle log; this is the deliberate cost of using the existing
authenticated RPC instead of opening an unauthenticated HTTP route. A native Remote namespace is a
future improvement.

## Security properties

- No HTTP routes. All reads/writes go through the authenticated `commands.execute` RPC.
- The side child can never execute a tool, including `send_message`.
- No raw HTML, remote images, or sanitized Markdown extensions are rendered in answers.
- Host errors are reduced to one bounded, control-character-free line.
- The plugin refuses to start from a subagent view; side questions are a main-session feature.
- Child sessions inherit the parent's sandbox/permission model; the guard only removes tool
  execution, it does not widen permissions.

## Honest limitations

- **Not truly ephemeral.** A local fork creates a durable child session. Marginalia archives it
  after completion when the workspace registry is available; it cannot make the Host forget it.
  History itself is stored in a sidecar domain.
- **No branch.** DSH exposes no public assistant-message injection/branch API. The `b` behavior of
  oh-my-pi is intentionally not imitated.
- **History replay is text, not role-level messages.** The child receives one user prompt with a
  `<btw-history>` section. Role-level replay would require a direct LLM call and would lose the
  fork's system/tools/cache inheritance.
- **Prompt cache is preserved, not guaranteed.** Marginalia never changes system/tools/messages;
  whether a provider reuses the prefix remains the provider's decision.
- **Parent partial is best-effort.** If the stream capture is unavailable, the section is omitted
  rather than fabricated.
- **Archive is best-effort.** A failed archive is logged; the side history is still correct.
- **Command lifecycle log growth.** Internal command results are recorded by the Host command
  runner. This is a known transport trade-off, documented above.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Layout:

```
src/index.ts            Host entry and wiring
src/shared.ts           protocol, limits, prompt, sanitization
src/host/               engine, storage, guard, stream capture, commands
src/client/             trigger source, store, bubble, history, styles
tests/                  pure unit and wiring tests
docs/                   design research, architecture, verification
```

## License

Apache-2.0. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The design is based on the three-way analysis in
[`docs/three-way-analysis.md`](docs/three-way-analysis.md).
