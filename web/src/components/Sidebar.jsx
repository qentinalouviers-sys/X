import { downloadMarkdown } from '../lib/exportMarkdown.js';

function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export default function Sidebar({ open, onClose, conversations, currentId, onSelect, onCreate, onDelete }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 transition-transform md:static md:translate-x-0 md:pointer-events-auto ${
          open ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 p-3">
          <button
            onClick={() => { onCreate(); onClose(); }}
            className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm font-medium hover:bg-neutral-700"
          >
            + Nouvelle conversation
          </button>
          <button className="rounded p-2 text-neutral-500 hover:bg-neutral-800 md:hidden" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm ${
                c.id === currentId ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
              }`}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => { onSelect(c.id); onClose(); }}>
                <div className="truncate">{c.title}</div>
                <div className="text-[11px] text-neutral-500">
                  {when(c.updatedAt)} · {c.messages.length} msg
                </div>
              </button>
              <button
                className="rounded p-1 text-[11px] text-neutral-600 opacity-0 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100"
                title="Exporter en Markdown"
                onClick={() => downloadMarkdown(c)}
              >
                ⇩
              </button>
              <button
                className="rounded p-1 text-[11px] text-neutral-600 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                title="Supprimer"
                onClick={() => { if (confirm(`Supprimer « ${c.title} » ?`)) onDelete(c.id); }}
              >
                ✕
              </button>
            </div>
          ))}
        </nav>

        <div className="border-t border-neutral-800 px-3 py-2 text-[11px] text-neutral-600">
          Stocké en localStorage sur cet appareil.
        </div>
      </aside>
    </>
  );
}
