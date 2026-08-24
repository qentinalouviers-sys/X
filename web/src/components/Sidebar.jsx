import { downloadMarkdown } from '../lib/exportMarkdown.js';

function stamp(ts) {
  const d = new Date(ts);
  const same = d.toDateString() === new Date().toDateString();
  return same
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

export default function Sidebar({
  open, onClose, conversations, currentId, onSelect, onCreate, onDelete, fx, onToggleFx, installable, onInstall, isAdmin,
}) {
  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-void/80 md:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[16.5rem] shrink-0 flex-col border-r border-line bg-pit transition-transform md:static md:translate-x-0 md:pointer-events-auto ${
          open ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="label text-acc glow">// SESSIONS</span>
          <button className="btn btn-ghost md:hidden" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="p-2">
          <button onClick={() => { onCreate(); onClose(); }} className="btn btn-primary frame w-full">
            + NOUVELLE SESSION
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
          {conversations.map((c, i) => {
            const active = c.id === currentId;
            return (
              <div
                key={c.id}
                className={`group relative flex items-stretch border-l-2 ${
                  active ? 'border-acc bg-raise' : 'border-transparent hover:bg-panel'
                }`}
              >
                <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => { onSelect(c.id); onClose(); }}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="label readout shrink-0 text-faint">
                      {String(i).padStart(2, '0')}
                    </span>
                    <span className={`truncate text-[12.5px] ${active ? 'text-acc' : 'text-fg'}`}>{c.title}</span>
                  </div>
                  <div className="label readout mt-0.5 pl-6">
                    {stamp(c.updatedAt)} · {String(c.messages.length).padStart(3, '0')} MSG
                  </div>
                </button>

                <div className="flex flex-col justify-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    className="px-1.5 text-[11px] text-dim hover:text-acc"
                    title="Exporter en Markdown"
                    onClick={() => downloadMarkdown(c)}
                  >
                    ⤓
                  </button>
                  <button
                    className="px-1.5 text-[11px] text-dim hover:text-danger"
                    title="Purger la session"
                    onClick={() => { if (confirm(`Purger « ${c.title} » ?`)) onDelete(c.id); }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="space-y-1.5 border-t border-line p-2">
          {isAdmin && (
            <a href="/admin" className="btn block text-center text-acc2 no-underline">
              ⌸ ESPACE ADMIN
            </a>
          )}
          {installable && (
            <button onClick={onInstall} className="btn w-full text-acc2">
              ⤋ INSTALLER L'APP
            </button>
          )}
          <button onClick={onToggleFx} className="btn w-full" title="Scanlines, halo, animations">
            FX {fx ? '[ON]' : '[OFF]'}
          </button>
          <p className="label leading-relaxed">
            STOCKAGE LOCAL // CE TERMINAL UNIQUEMENT
          </p>
        </div>
      </aside>
    </>
  );
}
