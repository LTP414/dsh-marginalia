/**
 * Deterministic LLM adapter for the browser end-to-end suite.
 *
 * It deliberately models the parts the real /btw path depends on:
 * token-level streaming with controllable delay, terminal finish reasons, a
 * forced tool call, and abort during a stream. Behaviour is selected by words
 * in the user prompt, so one host can serve every spec.
 */
export const name = 'dsh-e2e-fake-llm'
export const inject = ['llm']

const TOOL_PATH = process.env.DSH_E2E_TOOL_PATH ?? '/tmp/dsh-e2e-should-not-exist.txt'
const SLOW_DELAY_MS = Number(process.env.DSH_E2E_SLOW_DELAY_MS ?? 90)
const DEMO = process.env.DSH_E2E_DEMO === '1'
const DEMO_DELAY_MS = 35
const DISPLAY_NAME = DEMO ? 'Marginalia Demo' : 'Fake 1'

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return textOf(message)
  }
  return ''
}

function sideQuestion(text) {
  const match = /Question:\n([\s\S]*?)\n<\/btw>/.exec(text)
  return match?.[1]?.trim() ?? ''
}

function questionFromMessages(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const question = sideQuestion(textOf(message))
    if (question) return question
  }
  return ''
}

function isToolResult(messages) {
  const last = messages.at(-1)
  return last?.role === 'tool'
}

function* tokens(text) {
  for (const token of text.match(/\S+\s*/g) ?? [text]) yield token
}

function startText() {
  return { type: 'block-start', index: 0, blockType: 'text' }
}

function finishStop(outputTokens) {
  return [
    { type: 'usage', usage: { inputTokens: 32, outputTokens, totalTokens: 32 + outputTokens } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function finishAborted() {
  return { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted by the caller', code: 'ABORTED' } } }
}

async function* streamText(text, signal, delayMs) {
  let produced = ''
  yield startText()
  for (const token of tokens(text)) {
    if (signal?.aborted) { yield finishAborted(); return }
    produced += token
    yield { type: 'text-delta', index: 0, text: token }
    if (delayMs > 0) await sleep(delayMs, signal)
  }
  if (signal?.aborted) { yield finishAborted(); return }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: produced } }
  yield* finishStop(produced.split(/\s+/).filter(Boolean).length)
}

async function* streamToolCall(signal) {
  const args = JSON.stringify({ command: `touch ${TOOL_PATH}` })
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: 'call_e2e_tool', name: 'bash', argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_e2e_tool', name: 'bash', arguments: args } }
  yield { type: 'usage', usage: { inputTokens: 32, outputTokens: 8, totalTokens: 40 } }
  if (signal?.aborted) yield finishAborted()
  else yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

const adapter = {
  providerInfo(provider) {
    return { id: provider, name: DEMO ? 'Marginalia Demo' : 'E2E Fake LLM' }
  },
  providerRetryPolicy() {
    return undefined
  },
  imageRequestPricing() {
    return undefined
  },
  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  },
  async listModels(provider) {
    return [{ provider, id: 'fake-1', name: DISPLAY_NAME, description: 'Deterministic e2e model', inputModalities: ['text'] }]
  },
  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: DISPLAY_NAME,
      inputModalities: ['text'],
      context: { contextWindow: 200_000 },
      defaultMaxTokens: 8_192,
      systemPromptUpdate: 'in-history',
    }
  },
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options),
    }
  },
  async *stream(options) {
    const messages = options.messages ?? []
    const question = questionFromMessages(messages)

    // The tool-result request is the second step of the forced-tool spec.
    if (isToolResult(messages)) {
      yield* streamText('The read-only guard blocked the tool. The file was not changed.', options.signal, 0)
      return
    }

    if (question) {
      if (question.includes('[tool]')) {
        yield* streamToolCall(options.signal)
        return
      }
      if (DEMO) {
        const normalized = question.toLowerCase()
        const text = normalized.includes('start with')
          ? 'Start with the queue for the ship event. Expose a webhook only as a subscription layer on top, so retries and ordering stay under your control.'
          : normalized.includes('trade-off')
            ? "A queue decouples delivery from the partner's availability and makes retries explicit. A webhook is simpler to wire up, but it moves backpressure and retry policy onto the receiver."
            : 'Keep the event delivery on your side and treat the partner endpoint as a subscription. That keeps retries, ordering, and failure handling observable.'
        yield* streamText(text, options.signal, DEMO_DELAY_MS)
        return
      }
      const slow = question.includes('[slow]')
      const text = slow
        ? `This is a slow side answer about ${question.replace(/\[[^\]]+\]/g, '').trim()} with enough tokens to observe streaming.`
        : `Side answer: ${question}`
      yield* streamText(text, options.signal, slow ? SLOW_DELAY_MS : 0)
      return
    }

    // Session-title and other auxiliary calls.
    if (options.purpose === 'session-title') {
      yield* streamText(DEMO ? 'Queue vs webhook' : 'E2E Session', options.signal, 0)
      return
    }

    yield* streamText(
      DEMO
        ? "For this workflow I'd keep the order event on a queue and expose webhooks as subscriptions. That keeps retries and ordering under our control while still giving the partner a push endpoint."
        : 'Main answer accepted. The main conversation is seeded.',
      options.signal,
      DEMO ? 12 : 0,
    )
  },
}

export function apply(ctx) {
  ctx.llm.registerAdapter(['fake'], adapter)
}
