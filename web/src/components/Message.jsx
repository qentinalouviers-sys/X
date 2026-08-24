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

function Tag({ tone = 'dim', children }) {
  const tones = {
    dim: 'border-line text-dim',
    warn: 'border-warn/40 text-warn bg-warn/5',
    danger: 'border-danger/40 text-danger bg-danger/5',
  };
  return <span className={`label border px-1.5 py-0.5 ${tones[tone]}`}>{children}</span>;
}

function UserMessage({ message, onEdit, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="frame border border-acc2/40 bg-panel p-2">
        <div className="label mb-1.5 text-acc2">// RÉÉCRITURE DE LA REQUÊTE</div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(14, draft.split('\n').length + 1)}
          className="field scrollbar-thin w-full resize-y p-2 text-[13px]"
        />
        <div className="mt-2 flex justify-end gap-1.5">
          <button className="btn" onClick={() => { setDraft(message.content); setEditing(false); }}>
            ABANDON
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled || !draft.trim()}
            onClick={() => { setEditing(false); onEdit(message.id, draft); }}
          >
            RÉEXÉCUTER ▸
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <div className="label mb-1 flex items-center gap-2 text-acc2">
        <span>OPERATOR</span>
        <span className="rule flex-1 opacity-40" />
        <button
          className="opacity-0 transition hover:text-acc focus:opacity-100 group-hover:opacity-100"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          [ ÉDITER ]
        </button>
      </div>
      <div className="whitespace-pre-wrap break-words border-l-2 border-acc2/50 bg-acc2/[0.04] py-1.5 pl-3 pr-2 text-[13.5px] text-fg">
        {message.content}
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
    <div>
      <div className="label mb-1 flex items-center gap-2 text-acc">
        <span className="glow">NODE</span>
        <span className="rule flex-1 opacity-40" />
        {isLive && <span className="text-acc">◈ STREAM</span>}
      </div>

      {reasoning && (
        <div className="mb-2 border border-line bg-panel">
          <button
            className="label w-full px-2 py-1 text-left hover:text-acc"
            onClick={() => setShowReasoning((v) => !v)}
          >
            {showReasoning ? '▾' : '▸'} TRACE DE RAISONNEMENT
          </button>
          {showReasoning && (
            <div className="whitespace-pre-wrap border-t border-line px-2 py-2 text-[12px] text-faint">
              {reasoning}
            </div>
          )}
        </div>
      )}

      {answer ? (
        <>
          <Markdown streaming={isLive}>{answer}</Markdown>
          {isLive && <span className="caret ml-0.5" />}
        </>
      ) : isLive ? (
        <div className="readout flex items-center gap-2 text-[12px] text-dim">
          <span className="caret" />
          {liveStats && liveStats.elapsed > 1500
            ? `TRAITEMENT DU PROMPT… ${(liveStats.elapsed / 1000).toFixed(0)}s`
            : 'ALLOCATION…'}
        </div>
      ) : (
        !failed && <div className="text-[12px] text-faint">// RÉPONSE VIDE</div>
      )}

      {!isLive && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {truncated && <Tag tone="warn">TRONQUÉ · MAX_TOKENS</Tag>}
          {stopped && <Tag>SIGKILL OPÉRATEUR</Tag>}
          {failed && <Tag tone="danger">ERR · {message.error}</Tag>}
          {message.stats && (
            <span className="label readout text-faint">
              {message.stats.tokens} TOK · {message.stats.tps.toFixed(1)} T/S · {(message.stats.ms / 1000).toFixed(1)}S
            </span>
          )}
          <div className="ml-auto flex gap-1.5">
            {(truncated || stopped || (failed && message.content)) && (
              <button className="label hover:text-acc disabled:opacity-30" disabled={!canAct} onClick={() => onContinue(message.id)}>
                [ REPRENDRE ]
              </button>
            )}
            {onRegenerate && (
              <button className="label hover:text-acc disabled:opacity-30" disabled={!canAct} onClick={onRegenerate}>
                [ RELANCER ]
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
    <div className="px-3 py-3.5 sm:px-5">
      {message.role === 'user' ? (
        <UserMessage message={message} onEdit={props.onEdit} disabled={!props.canAct} />
      ) : (
        <AssistantMessage {...props} />
      )}
    </div>
  );
}

export default memo(Message);
