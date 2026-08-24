import { memo, useState } from 'react';
import Markdown from './Markdown.jsx';

/**
 * Some Qwen builds emit reasoning inline as <think>…</think> instead of using
 * the reasoning_content field. Split it out so it never pollutes the answer.
 */
function splitThinking(text = '') {
  const parts = [];
  let answer = '';
  const re = /<think>([\s\S]*?)(?:<\/think>|$)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    answer += text.slice(last, m.index);
    parts.push(m[1]);
    last = re.lastIndex;
  }
  answer += text.slice(last);
  return { answer, thinking: parts.join('\n\n') };
}

function Stats({ stats }) {
  if (!stats) return null;
  return (
    <span className="font-mono text-[11px] text-neutral-600">
      {stats.tokens} tok · {stats.tps.toFixed(1)} tok/s · {(stats.ms / 1000).toFixed(1)} s
    </span>
  );
}

function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-neutral-800 text-neutral-300',
    warn: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    error: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>;
}

function UserMessage({ message, onEdit, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-2xl rounded-2xl border border-sky-700/50 bg-neutral-900 p-3">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, draft.split('\n').length + 1)}
            className="w-full resize-y rounded bg-neutral-950 p-2 text-[15px] outline-none ring-1 ring-neutral-800 focus:ring-sky-600"
          />
          <div className="mt-2 flex justify-end gap-2 text-sm">
            <button className="rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800" onClick={() => { setDraft(message.content); setEditing(false); }}>
              Annuler
            </button>
            <button
              className="rounded bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              disabled={disabled || !draft.trim()}
              onClick={() => { setEditing(false); onEdit(message.id, draft); }}
            >
              Envoyer et régénérer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-end">
      <div className="flex max-w-[90%] flex-col items-end gap-1 sm:max-w-2xl">
        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-sky-900/40 px-4 py-2.5 text-[15px] ring-1 ring-sky-800/50">
          {message.content}
        </div>
        <button
          className="text-[11px] text-neutral-600 opacity-0 transition hover:text-neutral-300 focus:opacity-100 group-hover:opacity-100"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          Éditer
        </button>
      </div>
    </div>
  );
}

function AssistantMessage({ message, liveContent, isLive, liveStats, onRegenerate, onContinue, canAct }) {
  const raw = isLive ? liveContent : message.content;
  const { answer, thinking } = splitThinking(raw);
  const reasoning = message.reasoning || thinking;
  const [showReasoning, setShowReasoning] = useState(false);

  const truncated = message.finishReason === 'length';
  const stopped = message.finishReason === 'aborted';
  const failed = Boolean(message.error);

  return (
    <div className="flex flex-col gap-2">
      {reasoning && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <button
            className="w-full px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
            onClick={() => setShowReasoning((v) => !v)}
          >
            {showReasoning ? '▾' : '▸'} raisonnement
          </button>
          {showReasoning && (
            <div className="whitespace-pre-wrap px-3 pb-3 text-[13px] text-neutral-500">{reasoning}</div>
          )}
        </div>
      )}

      {answer ? (
        <Markdown streaming={isLive}>{answer}</Markdown>
      ) : isLive ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          {liveStats && liveStats.elapsed > 1500
            ? `traitement du prompt… ${(liveStats.elapsed / 1000).toFixed(0)} s`
            : 'réflexion…'}
        </div>
      ) : (
        !failed && <div className="text-sm italic text-neutral-600">(vide)</div>
      )}

      {isLive && answer && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-sky-400 align-middle" />}

      {!isLive && (
        <div className="flex flex-wrap items-center gap-2">
          {truncated && <Badge tone="warn">réponse tronquée (max_tokens atteint)</Badge>}
          {stopped && <Badge>interrompu</Badge>}
          {failed && <Badge tone="error">{message.error}</Badge>}
          <Stats stats={message.stats} />
          <div className="ml-auto flex gap-2 text-[11px]">
            {(truncated || stopped || (failed && message.content)) && (
              <button className="rounded px-2 py-1 text-sky-400 hover:bg-neutral-800 disabled:opacity-40" disabled={!canAct} onClick={() => onContinue(message.id)}>
                Continuer
              </button>
            )}
            {onRegenerate && (
              <button className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40" disabled={!canAct} onClick={onRegenerate}>
                Régénérer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Message(props) {
  const { message } = props;
  return (
    <div className="px-3 py-3 sm:px-6">
      {message.role === 'user' ? (
        <UserMessage message={message} onEdit={props.onEdit} disabled={!props.canAct} />
      ) : (
        <AssistantMessage {...props} />
      )}
    </div>
  );
}

export default memo(Message);
