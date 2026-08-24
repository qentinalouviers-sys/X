export default function ContextGauge({ usage }) {
  const pct = Math.min(100, Math.round(usage.ratio * 100));
  const color = usage.willOverflow ? 'bg-red-500' : usage.isTight ? 'bg-amber-400' : 'bg-sky-500';
  const label = `${usage.prompt} / ${usage.total} tokens (estimation)`;

  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-800 sm:w-28">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[11px] ${usage.isTight ? 'text-amber-300' : 'text-neutral-500'}`}>
        {pct}%
      </span>
    </div>
  );
}
