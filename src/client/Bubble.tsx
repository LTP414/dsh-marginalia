import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckIcon, ChevronIcon, CloseIcon, CopyIcon, HistoryIcon, MarginaliaIcon, PlusIcon, SendIcon, StopIcon } from './Icons'
import { MarginaliaMarkdown } from './Markdown'
import type { Bubble, MarginaliaStore } from './store'
import type { TranslateFn } from './locales'

function statusText(status: Bubble['status'], t: TranslateFn): string | undefined {
  switch (status) {
    case 'starting': return t('status.starting')
    case 'running': return t('status.answering')
    case 'cancelled': return t('status.cancelled')
    case 'interrupted': return t('status.interrupted')
    case 'error': return t('status.failed')
    default: return undefined
  }
}

function BubbleCard({ store, bubble, onInsert }: { readonly store: MarginaliaStore; readonly bubble: Bubble; readonly onInsert?: (text: string) => void }): React.JSX.Element {
  const t = store.t
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [inserted, setInserted] = useState(false)
  const [followOpen, setFollowOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [followError, setFollowError] = useState<string | undefined>()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const busy = bubble.status === 'starting' || bubble.status === 'running'
  const label = statusText(bubble.status, t)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!followOpen) return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [followOpen])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bubble.answer)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  const submitFollow = (event: React.SyntheticEvent): void => {
    event.preventDefault()
    const question = draft.trim()
    if (!question || bubble.topicId === null) return
    try {
      store.followUp(bubble.sessionId, bubble.topicId, question)
      setDraft('')
      setFollowError(undefined)
      setFollowOpen(false)
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : t('error.follow'))
    }
  }

  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if ((event.nativeEvent as KeyboardEvent).isComposing) return
    event.preventDefault()
    submitFollow(event)
  }

  return (
    <article className="mgl-bubble" data-testid="marginalia-bubble" data-status={bubble.status} aria-label={t('bubble.aria')}>
      <header className="mgl-head">
        <span className="mgl-mark"><MarginaliaIcon size={15} /></span>
        <span className="mgl-question" title={bubble.question}>{bubble.question}</span>
        <div className="mgl-actions">
          {bubble.answer && (
            <button type="button" className="mgl-icon-button" title={copied ? t('action.copied') : t('action.copy')} aria-label={copied ? t('action.copied') : t('action.copy')} onClick={() => { void copy() }}>
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
          )}
          {bubble.answer && onInsert && (
            <button
              type="button"
              className="mgl-icon-button"
              data-testid="marginalia-insert"
              title={inserted ? t('action.inserted') : t('action.insert')}
              aria-label={inserted ? t('action.inserted') : t('action.insert')}
              onClick={() => {
                onInsert(bubble.answer)
                setInserted(true)
                setTimeout(() => setInserted(false), 1_500)
              }}
            >
              {inserted ? <CheckIcon size={15} /> : <PlusIcon size={15} />}
            </button>
          )}
          {bubble.topicId !== null && !busy && (
            <button type="button" className="mgl-icon-button" title={t('action.followUp')} aria-label={t('action.followUp')} onClick={() => setFollowOpen(value => !value)}>
              <SendIcon size={15} />
            </button>
          )}
          <button type="button" className="mgl-icon-button" title={t('action.history')} aria-label={t('action.history')} onClick={() => { void store.openHistory(bubble.sessionId) }}>
            <HistoryIcon size={15} />
          </button>
          <button type="button" className="mgl-icon-button" title={bubble.collapsed ? t('action.expand') : t('action.collapse')} aria-label={bubble.collapsed ? t('action.expand') : t('action.collapse')} aria-expanded={!bubble.collapsed} onClick={() => store.toggleCollapse(bubble.id)}>
            <ChevronIcon size={15} up={bubble.collapsed} />
          </button>
          <button
            type="button"
            className={`mgl-icon-button${busy ? ' mgl-stop' : ''}`}
            title={busy ? t('action.stop') : t('action.close')}
            aria-label={busy ? t('action.stop') : t('action.close')}
            onClick={() => busy ? void store.cancel(bubble.id) : store.dismiss(bubble.id)}
          >
            {busy ? <StopIcon size={13} /> : <CloseIcon size={15} />}
          </button>
        </div>
      </header>

      {!bubble.collapsed && (
        <div className="mgl-body">
          {bubble.reference && (
            <details className="mgl-quote">
              <summary>{t('history.question')}</summary>
              <blockquote>{bubble.reference}</blockquote>
            </details>
          )}
          {label && (
            <div className="mgl-status" role="status" data-status={bubble.status}>
              {busy && <span className="mgl-spinner" aria-hidden="true" />}
              <span>{label}</span>
              {(bubble.status === 'cancelled' || bubble.status === 'interrupted') && bubble.answer && (
                <span className="mgl-muted">·</span>
              )}
            </div>
          )}
          {bubble.answer && (
            <div className="mgl-answer" data-testid="marginalia-answer">
              <MarginaliaMarkdown text={bubble.answer} streaming={bubble.streaming} />
            </div>
          )}
          {bubble.error && <p className="mgl-error" role="alert">{bubble.error}</p>}
          {copyError && <p className="mgl-error" role="alert">{t('error.copy')}</p>}
          {!busy && (bubble.status === 'error' || bubble.status === 'cancelled' || bubble.status === 'interrupted') && (
            <div className="mgl-row">
              <button type="button" className="mgl-text-button" onClick={() => store.retry(bubble.id)}>{t('action.retry')}</button>
              <button type="button" className="mgl-text-button" onClick={() => store.dismiss(bubble.id)}>{t('action.close')}</button>
            </div>
          )}
          {followOpen && bubble.topicId !== null && (
            <form className="mgl-follow" onSubmit={submitFollow}>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={keyDown}
                placeholder={t('follow.placeholder')}
                aria-label={t('follow.placeholder')}
                rows={2}
              />
              <div className="mgl-follow-row">
                <span className="mgl-muted">{t('follow.hint')}</span>
                <button type="submit" className="mgl-send" disabled={!draft.trim()}>
                  <SendIcon size={13} />
                  {t('follow.send')}
                </button>
              </div>
              {followError && <p className="mgl-error" role="alert">{followError}</p>}
            </form>
          )}
        </div>
      )}
    </article>
  )
}

/** Rendered at `conversation.input.overlay`; floats above the composer card. */
export function BubbleLayer({ store, sessionId, onInsert }: { readonly store: MarginaliaStore; readonly sessionId: string; readonly onInsert?: (text: string) => void }): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const bubbles = snapshot.bubbles
    .filter(bubble => bubble.sessionId === sessionId)
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
  if (bubbles.length === 0) return null
  return (
    <div className="mgl-layer" data-dsh-marginalia="">
      {bubbles.map(bubble => <BubbleCard key={bubble.id} store={store} bubble={bubble} onInsert={onInsert} />)}
    </div>
  )
}
