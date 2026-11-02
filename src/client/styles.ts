/**
 * Marginalia UI. Follows DSH theme tokens so the surface tracks the app's
 * appearance rather than the OS preference. All selectors are plugin-prefixed.
 */
export const CSS = `
.mgl-layer{
  position:absolute;left:0;right:0;bottom:0;z-index:40;
  display:flex;flex-direction:column;justify-content:flex-end;gap:8px;
  max-height:min(58vh,540px);overflow:auto;overscroll-behavior:contain;
  padding:0 4px 10px;box-sizing:border-box;pointer-events:none;
  scrollbar-width:thin;
}
.mgl-bubble{
  pointer-events:auto;box-sizing:border-box;min-width:0;flex:none;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));
  color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);
  border-radius:14px;box-shadow:var(--dsw-elevation-soft,0 10px 30px rgba(0,0,0,.16));
  font-size:13px;line-height:1.6;font-family:var(--dsw-font-family,inherit);
  overflow:hidden;backdrop-filter:blur(12px);
}
.mgl-bubble[data-status="error"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l2))}
.mgl-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;min-height:44px;min-width:0}
.mgl-mark{display:flex;align-items:center;color:var(--dsw-alias-brand-primary);flex:none}
.mgl-question{flex:1;min-width:0;font-weight:600;font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mgl-actions{display:flex;align-items:center;gap:2px;flex:none}
.mgl-icon-button{
  display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;
  background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;
  transition:background-color 120ms ease,color 120ms ease;
}
.mgl-icon-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mgl-icon-button:focus-visible,.mgl-send:focus-visible,.mgl-text-button:focus-visible,.mgl-topic:focus-visible{
  outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:-2px;
}
.mgl-icon-button.mgl-stop{color:var(--dsw-alias-state-error-primary)}
.mgl-tool-button{color:var(--dsw-alias-label-secondary)}
.mgl-tool-button:hover{color:var(--dsw-alias-brand-primary)}
.mgl-icon-button:disabled{opacity:.5;cursor:default}
.mgl-body{padding:0 12px 10px;min-width:0}
.mgl-status{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:2px 0 6px}
.mgl-status[data-status="running"]{color:var(--dsw-alias-label-secondary)}
.mgl-status[data-status="cancelled"]{color:var(--dsw-alias-state-warn-primary)}
.mgl-status[data-status="error"]{color:var(--dsw-alias-state-error-primary)}
.mgl-spinner{
  width:12px;height:12px;flex:none;border-radius:50%;
  border:1.5px solid color-mix(in srgb,currentColor 26%,transparent);
  border-top-color:currentColor;animation:mgl-spin .9s linear infinite;
}
@keyframes mgl-spin{to{transform:rotate(360deg)}}
.mgl-answer{max-height:min(38vh,340px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-right:2px}
.mgl-answer:only-child{max-height:min(42vh,400px)}
.mgl-md{overflow-wrap:anywhere;font-size:13px;line-height:1.72;color:var(--dsw-alias-label-primary)}
.mgl-md>*:first-child{margin-top:0}
.mgl-md>*:last-child{margin-bottom:0}
.mgl-md p{margin:6px 0}
.mgl-md h1,.mgl-md h2,.mgl-md h3,.mgl-md h4{font-size:14px;line-height:1.5;font-weight:650;margin:12px 0 4px}
.mgl-md ul,.mgl-md ol{padding-left:20px;margin:6px 0}
.mgl-md li{margin:2px 0}
.mgl-md a{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-underline-offset:2px}
.mgl-md code{font-family:var(--dsw-font-mono,Consolas,monospace);font-size:12px}
.mgl-md :not(pre)>code{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:1px 4px}
.mgl-md pre{max-width:100%;overflow:auto;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 10px;margin:8px 0;font-size:12px;line-height:1.55}
.mgl-md pre code{background:transparent;border:0;padding:0}
.mgl-md blockquote{margin:8px 0;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.mgl-md table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;margin:8px 0}
.mgl-md th,.mgl-md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;font-size:12px}
.mgl-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.mgl-md-streaming>*:last-child::after{content:"";display:inline-block;width:6px;height:13px;margin-left:2px;vertical-align:-2px;background:var(--dsw-alias-brand-primary);border-radius:1px;animation:mgl-caret 1s steps(1) infinite}
@keyframes mgl-caret{50%{opacity:0}}
.mgl-error{margin:6px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.mgl-muted{color:var(--dsw-alias-label-caption);font-size:11px;font-weight:400}
.mgl-row{display:flex;align-items:center;gap:4px;margin-top:6px}
.mgl-text-button{
  display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12px;line-height:18px;padding:3px 7px;border-radius:6px;cursor:pointer;
}
.mgl-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mgl-text-button.mgl-danger{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.mgl-quote{margin:0 0 6px;font-size:12px}
.mgl-quote summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.mgl-quote blockquote{margin:6px 0 0;padding:6px 8px;border-left:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:0 6px 6px 0;max-height:90px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.mgl-follow{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.mgl-follow textarea{
  box-sizing:border-box;width:100%;resize:vertical;min-height:54px;max-height:140px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 9px;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.55;
}
.mgl-follow textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.mgl-follow-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mgl-send{
  display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;flex:none;min-width:max-content;
  border:0;border-radius:7px;padding:4px 9px;min-height:26px;
  background:var(--dsw-alias-button-info-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);
  font:inherit;font-size:12px;font-weight:500;line-height:18px;cursor:pointer;white-space:nowrap;
}
.mgl-send:hover:not(:disabled){filter:brightness(1.06)}
/* Firefox paints disabled controls with UA colors; an opacity fade made the
   white label disappear into the pill at 1400px. Keep the label crisp. */
.mgl-send:disabled{opacity:1;cursor:default;filter:none}

/* History panel */
.mgl-backdrop{
  position:fixed;inset:0;z-index:80;display:grid;place-items:center;
  background:color-mix(in srgb,#000 38%,transparent);padding:24px;box-sizing:border-box;
  animation:mgl-fade .14s ease-out;
}
@keyframes mgl-fade{from{opacity:0}to{opacity:1}}
.mgl-panel{
  width:min(980px,calc(100vw - 48px));height:min(720px,calc(100vh - 48px));
  display:flex;flex-direction:column;overflow:hidden;isolation:isolate;
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);border-radius:16px;
  box-shadow:var(--dsw-elevation-strong,0 24px 70px rgba(0,0,0,.32));
  font-family:var(--dsw-font-family,inherit);font-size:13px;
}
.mgl-history{display:flex;flex-direction:column;min-height:0;height:100%}
.mgl-history-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.mgl-history-mark{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);flex:none}
.mgl-history-title{flex:1;min-width:0}
.mgl-history-title h2{margin:0;font-size:15px;line-height:20px;font-weight:650}
.mgl-history-title p{margin:1px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mgl-history-actions{display:flex;gap:2px;flex:none}
.mgl-history-body{display:flex;min-height:0;flex:1;overflow:hidden}
.mgl-topic-rail{width:284px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1);padding:12px 10px 8px;gap:8px}
.mgl-ask{display:flex;flex-direction:column;gap:6px;flex:none}
.mgl-ask textarea{
  box-sizing:border-box;width:100%;min-height:52px;max-height:120px;resize:vertical;
  border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 9px;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.55;
}
.mgl-ask textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.mgl-ask .mgl-send{align-self:flex-end}
.mgl-topic-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:2px 0;scrollbar-width:thin}
.mgl-topic{
  display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;border:0;background:transparent;
  color:var(--dsw-alias-label-primary);padding:8px 9px;border-radius:8px;cursor:pointer;font:inherit;
}
.mgl-topic:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mgl-topic.is-selected{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.mgl-topic-dot{width:7px;height:7px;border-radius:50%;margin-top:6px;flex:none;background:var(--dsw-alias-state-idle-primary)}
.mgl-topic-dot[data-status="running"]{background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));animation:mgl-pulse 1.2s ease-in-out infinite}
.mgl-topic-dot[data-status="complete"]{background:var(--dsw-alias-state-success-primary)}
.mgl-topic-dot[data-status="cancelled"]{background:var(--dsw-alias-state-warn-primary)}
.mgl-topic-dot[data-status="error"]{background:var(--dsw-alias-state-error-primary)}
@keyframes mgl-pulse{50%{opacity:.35}}
.mgl-topic-text{display:flex;flex-direction:column;min-width:0;gap:2px}
.mgl-topic-name{font-size:12.5px;line-height:17px;font-weight:550;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mgl-topic-meta{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}
.mgl-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.mgl-empty p{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mgl-empty span{font-size:11.5px;line-height:1.6}
.mgl-detail{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;padding:16px 18px 10px;overflow:hidden}
.mgl-detail-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:18px 4px}
.mgl-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:none;margin-bottom:10px}
.mgl-detail-head h3{margin:0;font-size:15px;line-height:20px;font-weight:650;overflow-wrap:anywhere}
.mgl-detail-head p{margin:2px 0 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.mgl-turns{display:flex;flex:1 1 auto;flex-direction:column;gap:12px;min-height:0;overflow-y:auto;scrollbar-width:thin;padding-right:2px}
.mgl-turn{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.mgl-turn[data-status="error"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}
.mgl-turn-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.mgl-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:999px;font-size:10.5px;line-height:17px;font-weight:600;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.mgl-badge[data-status="running"]{color:var(--dsw-alias-brand-primary)}
.mgl-badge[data-status="complete"]{color:var(--dsw-alias-state-success-primary)}
.mgl-badge[data-status="cancelled"]{color:var(--dsw-alias-state-warn-primary)}
.mgl-badge[data-status="error"]{color:var(--dsw-alias-state-error-primary)}
.mgl-turn-head .mgl-muted{margin-left:auto;margin-right:4px}
.mgl-turn-actions{display:flex;align-items:center;gap:2px;flex:none}
.mgl-turn-q{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}
.mgl-turn-q p{margin:0;font-size:12.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.mgl-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-caption);font-weight:600}
.mgl-turn-a{display:flex;flex-direction:column;gap:4px}
.mgl-turn-a .mgl-md{font-size:12.5px}
.mgl-history-follow{flex:none;margin-top:8px;padding-top:10px;background:var(--dsw-alias-bg-layer-1);position:relative;z-index:1}
.mgl-history-foot{flex:none;padding:7px 16px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
@media (max-width:760px){
  .mgl-backdrop{padding:0}
  .mgl-panel{width:100vw;height:100vh;border-radius:0;border:0}
  .mgl-history-body{flex-direction:column}
  .mgl-topic-rail{width:auto;max-height:42vh;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
  .mgl-layer{max-height:52vh}
  .mgl-answer{max-height:30vh}
}
@media (prefers-reduced-motion:reduce){
  .mgl-spinner,.mgl-topic-dot[data-status="running"]{animation:none}
  .mgl-md-streaming>*:last-child::after{animation:none}
  .mgl-backdrop{animation:none}
}
`
