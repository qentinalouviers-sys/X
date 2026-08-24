import { useEffect, useRef, useState } from 'react';
import { STATE } from '../lib/api.js';

function fmt(ms) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

export default function Composer({ text, onTextChange, onSend, onStop, isStreaming, waitingForModel, liveStats, usage, status }) {
  const [overflowAck, setOverflowAck] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [text]);

  const offline = status.state === STATE.OFFLINE;
  const wouldOverflow = usage.willOverflow;
  const needsAck = wouldOverflow && !overflowAck;
  const canSend = !isStreaming && !offline && text.trim().length > 0 && !needsAck;

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    onTextChange('');
    setOverflowAck(false);
  };

  const onKeyDown = (e) => {
    // Enter sends on desktop; on touch keyboards Enter must insert a newline.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-950 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {isStreaming && (
          <div className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2 text-[12px]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            {waitingForModel ? (
              <span className="text-amber-300">Modèle en cours de chargement, nouvelle tentative automatique…</span>
            ) : (
              <span className="font-mono text-neutral-400">
                {liveStats?.tokens ?? 0} tok · {(liveStats?.tps ?? 0).toFixed(1)} tok/s · {fmt(liveStats?.elapsed ?? 0)}
              </span>
            )}
            <button onClick={onStop} className="ml-auto rounded bg-neutral-800 px-3 py-1 font-medium text-red-300 hover:bg-neutral-700">
              Stop
            </button>
          </div>
        )}

        {wouldOverflow && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200 ring-1 ring-amber-500/30">
            <span>
              ~{usage.prompt} tokens de prompt + {usage.reserved} réservés &gt; {usage.total}. Le serveur tronquera
              silencieusement le début de la conversation.
            </span>
            {!overflowAck && (
              <button onClick={() => setOverflowAck(true)} className="ml-auto rounded bg-amber-500/20 px-2 py-1 font-medium hover:bg-amber-500/30">
                Envoyer quand même
              </button>
            )}
          </div>
        )}

        {offline && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-200 ring-1 ring-red-500/30">
            llama-server injoignable ({status.detail}). Vérifiez le LaunchAgent sur le Mac.
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-2 focus-within:border-neutral-700">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isStreaming ? 'Génération en cours…' : 'Message…'}
            className="scrollbar-thin max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] outline-none placeholder:text-neutral-600"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            title={isStreaming ? 'Une seule génération à la fois (--parallel 1)' : 'Envoyer'}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {isStreaming ? '…' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
