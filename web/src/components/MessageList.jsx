import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Message from './Message.jsx';

const BANNER = [
  '  ███╗   ██╗██╗   ██╗██╗     ██╗     ',
  '  ████╗  ██║██║   ██║██║     ██║     ',
  '  ██╔██╗ ██║██║   ██║██║     ██║     ',
  '  ██║╚██╗██║██║   ██║██║     ██║     ',
  '  ██║ ╚████║╚██████╔╝███████╗███████╗',
  '  ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝',
];

export default function MessageList({ conversation, live, liveStats, canAct, onEdit, onRegenerate, onContinue }) {
  const scroller = useRef(null);
  const [pinned, setPinned] = useState(true);
  const messages = conversation.messages;
  const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant');

  // Follow the stream, but stop fighting the user the moment they scroll up.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  useLayoutEffect(() => {
    if (pinned) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, live?.content, pinned]);

  useEffect(() => {
    setPinned(true);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [conversation.id]);

  return (
    <div ref={scroller} onScroll={onScroll} className="scrollbar-thin relative flex-1 overflow-y-auto">
      {messages.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
          <pre className="text-acc glow text-[7px] leading-tight sm:text-[10px]">{BANNER.join('\n')}</pre>
          <div className="space-y-1 text-center">
            <p className="label">BUFFER VIDE · EN ATTENTE D'ENTRÉE</p>
            <p className="label text-faint">DÉBIT NOMINAL ~5.8 T/S · 1000 TOK ≈ 3 MIN</p>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl divide-y divide-line/60">
        {messages.map((m, i) => (
          <Message
            key={m.id}
            message={m}
            isLive={live?.messageId === m.id}
            liveContent={live?.messageId === m.id ? live.content : ''}
            liveStats={live?.messageId === m.id ? liveStats : null}
            canAct={canAct}
            onEdit={onEdit}
            onContinue={onContinue}
            onRegenerate={i === lastAssistant ? onRegenerate : undefined}
          />
        ))}
      </div>

      {!pinned && (
        <button
          onClick={() => { setPinned(true); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }}
          className="btn btn-primary sticky bottom-3 left-1/2 -translate-x-1/2"
        >
          ▼ SUIVRE LE FLUX
        </button>
      )}
    </div>
  );
}
