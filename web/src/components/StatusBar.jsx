import { STATE } from '../lib/api.js';
import ContextGauge from './ContextGauge.jsx';

const DOTS = {
  [STATE.ONLINE]: 'bg-emerald-500',
  [STATE.LOADING]: 'bg-amber-400 animate-pulse',
  [STATE.OFFLINE]: 'bg-red-500',
  [STATE.UNKNOWN]: 'bg-neutral-600 animate-pulse',
};

const LABELS = {
  [STATE.ONLINE]: 'en ligne',
  [STATE.LOADING]: 'chargement du modèle',
  [STATE.OFFLINE]: 'hors ligne',
  [STATE.UNKNOWN]: 'connexion',
};

export default function StatusBar({ status, model, usage, onToggleSidebar, onToggleSettings, title }) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-950/90 px-3 py-2 backdrop-blur">
      <button
        className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 md:hidden"
        onClick={onToggleSidebar}
        aria-label="Conversations"
      >
        ☰
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOTS[status.state]}`} />
          <span>{LABELS[status.state]}</span>
          {model && <span className="truncate font-mono">· {model}</span>}
        </div>
      </div>

      <ContextGauge usage={usage} />

      <button
        className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800"
        onClick={onToggleSettings}
        aria-label="Réglages"
      >
        ⚙
      </button>
    </header>
  );
}
