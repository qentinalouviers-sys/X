import { STATE } from '../lib/api.js';
import ContextGauge from './ContextGauge.jsx';

const LINK = {
  [STATE.ONLINE]: { text: 'LINK::SECURE', cls: 'text-acc', dot: 'bg-acc' },
  [STATE.LOADING]: { text: 'LINK::WARMUP', cls: 'text-warn', dot: 'bg-warn animate-pulse' },
  [STATE.OFFLINE]: { text: 'LINK::DOWN', cls: 'text-danger', dot: 'bg-danger' },
  [STATE.UNKNOWN]: { text: 'LINK::PROBE', cls: 'text-dim', dot: 'bg-dim animate-pulse' },
};

export default function StatusBar({ status, model, usage, onToggleSidebar, onToggleSettings, title }) {
  const link = LINK[status.state];

  return (
    <header className="shrink-0 border-b border-line bg-pit/95 backdrop-blur">
      <div className="flex items-center gap-2 px-2 py-1.5 sm:px-3">
        <button className="btn btn-ghost md:hidden" onClick={onToggleSidebar} aria-label="Sessions">
          ▤
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-acc glow">❯</span>
            <span className="truncate text-[13px] text-fg">{title}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 overflow-hidden">
            <span className={`inline-block h-1.5 w-1.5 shrink-0 ${link.dot}`} />
            <span className={`label shrink-0 ${link.cls}`}>{link.text}</span>
            <span className="label truncate">
              NODE::{model ? model.toUpperCase() : '—'}
            </span>
          </div>
        </div>

        <ContextGauge usage={usage} />

        <button className="btn btn-ghost" onClick={onToggleSettings} aria-label="Configuration">
          ⚙
        </button>
      </div>
      <div className="rule" />
    </header>
  );
}
