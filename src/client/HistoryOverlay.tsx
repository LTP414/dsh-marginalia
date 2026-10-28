import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckIcon, CloseIcon, CopyIcon, HistoryIcon, MarginaliaIcon, RefreshIcon, SendIcon, TrashIcon } from './Icons'
import { MarginaliaMarkdown } from './Markdown'
import type { HistoryState, MarginaliaStore } from './store'
import type { TranslateFn } from './locales'
import type { BtwStatus, BtwTurn } from '../shared'

function relativeTime(time: number, t: TranslateFn): string {
  const delta = Math.max(0, Date.now() - time)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return t('relative.justNow')
  if (minutes < 60) return t('relative.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('relative.hours', { count: hours })
  return t('relative.days', { count: Math.floor(hours / 24) })
}

function statusLabel(status: BtwStatus, t: TranslateFn): string {
  switch (status) {
    case 'running': return t('history.status.running')
    case 'complete': return t('history.status.complete')
    case 'cancelled': return t('history.status.cancelled')
    case 'error': return t('history.status.error')
    case 'interrupted': return t('history.status.interrupted')
  }
}

function TurnBlock({
  turn,
  store,
  t,
  copied,
  onCopy,
  onRetry,
}: {
  readonly turn: BtwTurn
  readonly store: MarginaliaStore
  readonly t: TranslateFn
  readonly copied: string | null
  readonly onCopy: (turn: BtwTurn) => void
  readonly onRetry: () => void
}): React.JSX.Element {
  const running = turn.status === 'running'
  return (
    <section className="mgl-turn" data-status={turn.status}>
      <div className="mgl-turn-head">
        <span className="mgl-badge" data-status={turn.status}>
          {running && <span className="mgl-spinner" aria-hidden="true" />}
          {statusLabel(turn.status, t)}
        </span>
        <span className="mgl-muted">{relativeTime(turn.updatedAt, t)}</span>
        <div className="mgl-turn-actions">
          {turn.answer && (
            <button type="button" className="mgl-icon-button" title={copied === turn.id ? t('history.copied') : t('history.copy')} aria-label={t('history.copy')} onClick={() => onCopy(turn)}>
              {copied === turn.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            </button>
          )}
          {(turn.status === 'error' || turn.status === 'cancelled' || turn.status === 'interrupted') && (
            <button type="button" className="mgl-text-button" onClick={onRetry}>{t('action.retry')}</button>
          )}
        </div>
      </div>
      <div className="mgl-turn-q">
        <span className="mgl-label">{t('history.question')}</span>
        <p>{turn.question}</p>
      </div>
      <div className="mgl-turn-a">
        <span className="mgl-label">{t('history.answer')}</span>
        {turn.answer
          ? <MarginaliaMarkdown text={turn.answer} streaming={running} />
          : <p className="mgl-muted">{running ? t('status.answering') : t('history.noAnswer')}</p>}
      </div>
      {turn.error && <p className="mgl-error" role="alert">{turn.error}</p>}
    </section>
  )
}

function HistoryBody({ store, history, t }: { readonly store: MarginaliaStore; readonly history: HistoryState; readonly t: TranslateFn }): React.JSX.Element {
  const [ask, setAsk] = useState('')
  const [follow, setFollow] = useState('')
  const [askError, setAskError] = useState<string | undefined>()
  const [followError, setFollowError] = useState<string | undefined>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    setConfirmDelete(false)
    setFollow('')
    setFollowError(undefined)
  }, [history.selectedId])

  const submitAsk = (event: React.SyntheticEvent): void => {
    event.preventDefault()
    const question = ask.trim()
    if (!question) return
    try {
      store.ask(history.sessionId, question)
      setAsk('')
      setAskError(undefined)
      store.closeHistory()
    } catch (error) {
      setAskError(error instanceof Error ? error.message : t('error.generic'))
    }
  }

  const submitFollow = (event: React.SyntheticEvent): void => {
    event.preventDefault()
    const question = follow.trim()
    if (!question || !history.topic) return
    try {
      store.followUp(history.sessionId, history.topic.id, question)
      setFollow('')
      setFollowError(undefined)
      store.closeHistory()
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : t('error.follow'))
    }
  }

  const copy = async (turn: BtwTurn): Promise<void> => {
    try {
      await navigator.clipboard.writeText(turn.answer)
      setCopied(turn.id)
    } catch {
      setCopied(null)
    }
  }

  const deleteTopic = (): void => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setConfirmDelete(false)
    if (history.topic) void store.deleteTopic(history.topic.id)
  }

  return (
    <div className="mgl-history">
      <header className="mgl-history-head">
        <span className="mgl-history-mark"><MarginaliaIcon size={18} /></span>
        <div className="mgl-history-title">
          <h2>{t('history.title')}</h2>
          <p>{t('history.subtitle')}</p>
        </div>
        <div className="mgl-history-actions">
          <button type="button" className="mgl-icon-button" title={t('history.reload')} aria-label={t('history.reload')} onClick={() => { void store.refreshHistory() }}>
            <RefreshIcon size={15} />
          </button>
          <button ref={closeRef} type="button" className="mgl-icon-button" title={t('history.close')} aria-label={t('history.close')} onClick={() => store.closeHistory()}>
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      <div className="mgl-history-body">
        <aside className="mgl-topic-rail">
          <form className="mgl-ask" onSubmit={submitAsk}>
            <textarea
              value={ask}
              onChange={event => setAsk(event.target.value)}
              placeholder={t('history.askPlaceholder')}
              aria-label={t('history.askPlaceholder')}
              rows={2}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent as KeyboardEvent).isComposing) {
                  event.preventDefault()
                  submitAsk(event)
                }
              }}
            />
            <button type="submit" className="mgl-send" disabled={!ask.trim()}>
              <SendIcon size={13} />
              {t('history.ask')}
            </button>
          </form>
          {askError && <p className="mgl-error" role="alert">{askError}</p>}

          <div className="mgl-topic-list" role="listbox" aria-label={t('history.title')}>
            {history.topics.length === 0 && !history.loading && (
              <div className="mgl-empty">
                <HistoryIcon size={22} />
                <p>{t('history.empty')}</p>
                <span>{t('history.emptyHint')}</span>
              </div>
            )}
            {history.topics.map(topic => (
              <button
                key={topic.id}
                type="button"
                role="option"
                aria-selected={history.selectedId === topic.id}
                className={`mgl-topic${history.selectedId === topic.id ? ' is-selected' : ''}`}
                onClick={() => { void store.selectTopic(topic.id) }}
              >
                <span className="mgl-topic-dot" data-status={topic.status} aria-hidden="true" />
                <span className="mgl-topic-text">
                  <span className="mgl-topic-name">{topic.title}</span>
                  <span className="mgl-topic-meta">{t('history.turns', { count: topic.turnCount })} · {relativeTime(topic.updatedAt, t)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="mgl-detail" aria-busy={history.loadingTopic}>
          {history.loadingTopic && <div className="mgl-detail-loading"><span className="mgl-spinner" />{t('history.loading')}</div>}
          {!history.loadingTopic && !history.topic && history.topics.length > 0 && <div className="mgl-detail-loading">{t('history.empty')}</div>}
          {history.topic && (
            <>
              <div className="mgl-detail-head">
                <div>
                  <h3>{history.topic.title}</h3>
                  <p>{t('history.turns', { count: history.topic.turns.length })}</p>
                </div>
                <button
                  type="button"
                  className={`mgl-text-button${confirmDelete ? ' mgl-danger' : ''}`}
                  title={t('history.deleteConfirm')}
                  onClick={deleteTopic}
                >
                  <TrashIcon size={14} />
                  {confirmDelete ? `${t('action.delete')}?` : t('action.delete')}
                </button>
              </div>
              <div className="mgl-turns">
                {history.topic.turns.map(turn => (
                  <TurnBlock
                    key={turn.id}
                    turn={turn}
                    store={store}
                    t={t}
                    copied={copied}
                    onCopy={turn => { void copy(turn) }}
                    onRetry={() => {
                      if (!history.topic) return
                      store.retryTurn(history.sessionId, history.topic.id, turn.question)
                      store.closeHistory()
                    }}
                  />
                ))}
              </div>
              <form className="mgl-follow mgl-history-follow" onSubmit={submitFollow}>
                <textarea
                  value={follow}
                  onChange={event => setFollow(event.target.value)}
                  placeholder={t('history.followPlaceholder')}
                  aria-label={t('history.followPlaceholder')}
                  rows={2}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent as KeyboardEvent).isComposing) {
                      event.preventDefault()
                      submitFollow(event)
                    }
                  }}
                />
                <div className="mgl-follow-row">
                  <span className="mgl-muted">{t('follow.hint')}</span>
                  <button type="submit" className="mgl-send" disabled={!follow.trim()}>
                    <SendIcon size={13} />
                    {t('history.follow')}
                  </button>
                </div>
                {followError && <p className="mgl-error" role="alert">{followError}</p>}
              </form>
            </>
          )}
          {history.error && <p className="mgl-error" role="alert">{history.error}</p>}
        </section>
      </div>

      <footer className="mgl-history-foot">{t('history.footer')}</footer>
    </div>
  )
}

/** Rendered at the root `shell.overlay`. */
export function HistoryOverlay({ store }: { readonly store: MarginaliaStore }): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const history = snapshot.history
  const open = history?.open === true
  const t = store.t

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      store.closeHistory()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, store])

  if (!history || !open) return null

  return (
    <div
      className="mgl-backdrop"
      data-dsh-marginalia-history=""
      onMouseDown={event => { if (event.target === event.currentTarget) store.closeHistory() }}
    >
      <div className="mgl-panel" role="dialog" aria-modal="true" aria-label={t('history.title')}>
        <HistoryBody store={store} history={history} t={t} />
      </div>
    </div>
  )
}
