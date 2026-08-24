import { useEffect, useRef, useState } from 'react';
import { STATE } from '../lib/api.js';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Composer({
  text, onTextChange, onSend, onStop, isStreaming, waitingForModel, liveStats, usage, status,
}) {
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

  const frame = liveStats ? SPIN[Math.floor(liveStats.elapsed / 90) % SPIN.length] : SPIN[0];

  return (
    <div className="shrink-0 border-t border-line bg-pit px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 sm:px-3">
      <div className="mx-auto w-full max-w-3xl space-y-1.5">
        {isStreaming && (
          <div className="frame flex items-center gap-3 border border-acc/30 bg-acc/[0.04] px-2 py-1.5">
            <span className="text-acc glow">{frame}</span>
            {waitingForModel ? (
              <span className="label text-warn">
                MODÈLE EN CHARGEMENT · NOUVELLE TENTATIVE AUTOMATIQUE
              </span>
            ) : (
              <span className="label readout text-acc">
                {String(liveStats?.tokens ?? 0).padStart(4, '0')} TOK
                <span className="text-faint"> · </span>
                {(liveStats?.tps ?? 0).toFixed(1)} T/S
                <span className="text-faint"> · </span>
                {clock(liveStats?.elapsed ?? 0)}
              </span>
            )}
            <button onClick={onStop} className="btn btn-danger ml-auto py-1">
              ■ KILL
            </button>
          </div>
        )}

        {wouldOverflow && (
          <div className="flex flex-wrap items-center gap-2 border border-warn/40 bg-warn/[0.06] px-2 py-1.5">
            <span className="label leading-relaxed text-warn">
              ⚠ DÉBORDEMENT : ~{usage.prompt} TOK DE PROMPT + {usage.reserved} RÉSERVÉS &gt; {usage.total}.
              LE SERVEUR TRONQUERA SILENCIEUSEMENT LE DÉBUT DE LA SESSION.
            </span>
            {!overflowAck && (
              <button onClick={() => setOverflowAck(true)} className="btn ml-auto border-warn/40 text-warn">
                FORCER
              </button>
            )}
          </div>
        )}

        {offline && (
          <div className="border border-danger/40 bg-danger/[0.06] px-2 py-1.5">
            <span className="label text-danger">
              ✕ NŒUD INJOIGNABLE · {status.detail.toUpperCase()}
            </span>
          </div>
        )}

        <div className="frame flex items-end gap-2 border border-line bg-panel px-2 py-1.5 focus-within:border-acc/50">
          <span className="pb-1.5 text-acc glow select-none">❯</span>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isStreaming ? 'CANAL OCCUPÉ…' : 'saisir la requête…'}
            className="scrollbar-thin max-h-[200px] flex-1 resize-none bg-transparent py-1 text-[16px] text-fg outline-none placeholder:text-faint sm:text-[13.5px]"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            title={isStreaming ? 'Canal saturé : --parallel 1' : 'Transmettre'}
            className="btn btn-primary shrink-0 py-1.5"
          >
            {isStreaming ? '···' : 'EXEC ▸'}
          </button>
        </div>
      </div>
    </div>
  );
}
