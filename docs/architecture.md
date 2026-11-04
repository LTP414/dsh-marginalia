# Architecture

This document records the decisions that are easy to lose when reading the code.

## Goals

1. A side question is answered against the **same** session state as the main conversation.
2. Read-only is an **execution** property, not a request to the model.
3. History and follow-ups belong to a topic, not to a frozen child session.
4. Nothing is written into the main transcript.
5. Missing DSH capabilities are degraded honestly.

## Layers

```
Client (Web)
  inputTriggers source  ──> MarginaliaStore ──> BubbleLayer (conversation.input.overlay)
                                      │          HistoryOverlay (shell.overlay)
                                      │          toolbar button (conversation.input.left)
                                      │
                                      └─ remote.commands.execute (authenticated RPC)
Host
  hidden commands ──> BtwEngine ──> BtwStore (storage.domain)
                          │
                          ├─ ChildGuard (tools.guard, root + child scope)
                          ├─ StreamCapture (agent/assistant-stream)
                          └─ subagents.startActivation({ provider: 'fork', delivery: 'caller' })
```

## Why the request prefix is preserved

The fork provider seeds the child with the parent's completed turn prefix. Marginalia adds exactly
one user-role message. The current open turn is not part of the seed, so `openTurnSnapshot()` reads
the events after the last `turn/end` and adds a compact `<parent-in-progress>` block: current user
request, latest assistant text, recent tool calls/results, and the active step. This is capped at 6k
characters; it is snapshot data taken at ask time, not a live feed. It does **not**:

- change the system prompt or add a system section;
- pass `persona`, `agentPreset`, or `toolFilter`;
- register a new tool or remove inherited tools;
- rewrite inherited messages.

`agentOptions.maxTokens` is `min(32k, parentMaxTokens)`. It changes the completion budget, not the
prompt prefix. The completed prefix can still hit the provider cache; the open-turn snapshot is new
text and cannot be inside that prefix. Maximizing cache through the open turn would require reusing
the parent's exact request and a direct LLM call, which would replace the child-session transport.

This is why the read-only instruction cannot be a tool filter: removing tools would change the
request and defeat the cache. The instruction is a user turn; the enforcement is a guard.

## Why read-only is a guard

`ctx.tools.guard()` is a monotonic execution-time barrier. The engine reserves the child id before
`startActivation`, so the root guard knows the id before any model request can produce a tool call.
A second guard is installed on the child's own scope when `agent/created` fires. The prompt tells
the model that calls will be rejected; the guard makes that true.

The guard denies every tool, including `send_message`. There is no "reply to parent" exception in
v1: the answer stays in the bubble and history.

## Job lifecycle

```
ask:
  validate → one-active-per-parent → reserve child id → guard
  persist running turn
  build prompt (history + open-turn snapshot + live partial)
  startActivation (resolves on acceptance)
  return { topic, turn } immediately
  background settle:
    await result → sanitize → persist complete/cancelled/error
    release guard → dispose activation → archive child best-effort

cancel:
  abort controller → await startup/cleanup (bounded 5s)
  settle persists the captured partial as cancelled
  a turn id cancelled before ask arrives is tombstoned for 5 minutes
```

Timeout is a controller abort with `cancelReason = 'timeout'`, persisted as `error`; user stop is
`cancelled`; plugin unload is `interrupted`.

## Topic model

A topic is the follow-up line. `turns[0]` is its root question. A follow-up is always a **new
child** with the same topic id:

- it sees the parent as it is now;
- its prompt replays prior topic turns as `<btw-history>`;
- it does not reuse a possibly stale child transcript;
- prompt-cache reuse is still possible because the prefix is the parent's, not the topic's.

## Streaming

The Host returns after activation acceptance, not after the answer. The Client preallocates the
turn id, the Host uses it as the child id, and the Client retains that child session after the
acceptance response. It follows the child's Chat target for partial text and subscribes to the
session lifecycle. When the session goes idle, the Client reads the canonical turn back from the
Host once (with bounded retries) so error/cancellation status wins over local inference.

A fork seed is inherited history, not side history. The child Chat target therefore contains the
parent's completed turns. The Host returns `baselineTurn` (the parent's last completed turn) with
the acceptance payload, and the Client only reads assistant nodes with `turn > baselineTurn`.
Without this filter, the parent's last answer would appear inside the side bubble while streaming.

If retention fails (for example the child catalog row has not reached this Client yet), the store
falls back to a bounded read-back loop rather than leaving a spinner forever.

## Transport trade-off

DSH's public Client Remote namespaces are generated from Typert descriptors. A third-party
workspace bundle cannot cheaply generate that surface here. The implementation therefore uses
hidden host commands over `remote.commands.execute`:

- authenticated by the existing RPC carrier;
- no new HTTP route or token scheme;
- hidden from the slash directory via a `commands.list` wrapper;
- quiet in the session log via an `appendLifecycle` wrapper that drops the `command/run` /
  `command/done` pair for these exact command ids.

The last point matters: before the quieting shim, every ask produced Chat command nodes and a
`btw-get` result — including the full topic JSON — was copied into `command/done`. The shim
reuses the authenticated RPC without polluting the main transcript. It is an instance-level
compatibility patch: if a future DSH removes `appendLifecycle`, the plugin warns and falls back to
visible lifecycle rows.

The alternative — a raw HTTP/SSE route — was rejected because the analysis explicitly warns about
unauthenticated cross-session reads. A native Remote namespace is the right long-term replacement;
the protocol helpers in `src/shared.ts` keep that migration local.

## Insert-to-composer

The `conversation.input.overlay` standard props expose `inputActions`. The bubble's insert button
calls `inputActions.setDraft(answer)`, so a user can carry an answer into the main composer without
writing it to the transcript or triggering a model call. This is the honest replacement for
oh-my-pi's `b` branch: DSH still has no public assistant-injection/branch API.

## Storage

`marginalia` domain, version 1, table `topics`, single record per key. Writes are serialized per
key inside `BtwStore` even though the domain already serializes its own chain; the extra queue
makes read-modify-write in `updateTurn` deterministic for one turn. Startup repairs `running` to
`interrupted`.

If `storageDomain` is absent, a process-memory table keeps the plugin usable and logs a warning.
There is no global JSON file.

## Client state

`MarginaliaStore` is a single immutable snapshot consumed with `useSyncExternalStore`. It owns:

- bubbles (ephemeral, per session, capped at 6 with oldest finished eviction);
- history panel state (open, list, selection, topic, loading/error);
- one watcher per bubble (session reference, chat target subscription, finalize retry);
- one AbortController per ask/history request.

The Host remains the durability authority. Client state is recoverable by reopening history.

The history detail is a three-row flex column: fixed head, scrollable `.mgl-turns`, fixed
follow-up composer. Do not make `.mgl-detail` the scroll container; that was the dark-theme bug
where later turns painted under the follow-up input. The send buttons use
`button-info-fill` with `label-primary-foreground`, never `brand-primary` + white: in the DSH dark
palette `brand-primary` is near-white and produced an invisible label.

## Browser verification

The suite in [`e2e/`](../e2e) launches a real isolated Host, authenticates through the launch
token, drives Chromium, and uses a deterministic fake LLM. See [`e2e.md`](e2e.md). Unit tests pin
the pure logic; the browser suite pins the wiring, DOM, streaming, cancellation, reload, and
tool-guard behavior.

## Failure matrix

| Failure | Behaviour |
| --- | --- |
| fork provider absent or not context-inheriting | ask error, bubble shows the reason |
| same parent already running | `BtwBusyError`, no queue |
| global 4 active | capacity error |
| storage domain absent | memory history + warning |
| storage write fails on start | ask returns error before activation |
| storage write fails on settle | logged; history may show `running` until restart repair |
| child session retain fails | bounded Host read-back; then honest attach error |
| plugin unload | abort jobs, mark `interrupted`, release guard, close store |
| child archive fails | logged; nothing user-visible |
| user closes before ask accepts | turn id tombstone; late ask refuses |
| parent answer inherited by fork | hidden by the `baselineTurn` filter |
| command lifecycle hook unavailable | warning; command events become visible again |
| browser e2e host fails to start | fixture fails with the isolated host log path |
