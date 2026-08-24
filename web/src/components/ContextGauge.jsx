const CELLS = 12;

export default function ContextGauge({ usage }) {
  const pct = Math.min(100, Math.round(usage.ratio * 100));
  const filled = Math.min(CELLS, Math.round(usage.ratio * CELLS));
  const tone = usage.willOverflow ? 'text-danger' : usage.isTight ? 'text-warn' : 'text-acc';

  return (
    <div
      className="flex shrink-0 flex-col items-end gap-0.5"
      title={`Contexte estimé : ${usage.prompt} / ${usage.total} tokens`}
    >
      <div className={`readout flex gap-px ${tone}`} aria-hidden="true">
        {Array.from({ length: CELLS }, (_, i) => (
          <span
            key={i}
            className={`inline-block h-2.5 w-1 ${i < filled ? 'bg-current' : 'bg-line'}`}
          />
        ))}
      </div>
      <span className={`label readout ${tone}`}>CTX {String(pct).padStart(2, '0')}%</span>
    </div>
  );
}
