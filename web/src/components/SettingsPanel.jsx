import { CONTEXT_SIZE } from '../lib/api.js';

function Slider({ label, value, min, max, step, onChange, hint }) {
  return (
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-neutral-300">{label}</span>
        <span className="font-mono text-xs text-neutral-400">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
      {hint && <p className="text-[11px] text-neutral-600">{hint}</p>}
    </label>
  );
}

export default function SettingsPanel({ open, onClose, settings, onChange, conversation, onSystemPromptChange }) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/60" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-neutral-800 bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-800 p-3">
          <h2 className="text-sm font-medium">Réglages</h2>
          <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800" onClick={onClose}>✕</button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto p-4">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-neutral-300">System prompt</span>
              <span className="text-[11px] text-neutral-600">cette conversation</span>
            </div>
            <textarea
              value={conversation.systemPrompt ?? ''}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={6}
              className="scrollbar-thin w-full resize-y rounded-lg bg-neutral-950 p-2 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-sky-600"
            />
            <button
              className="text-[11px] text-sky-400 hover:underline"
              onClick={() => onChange({ systemPrompt: conversation.systemPrompt ?? '' })}
            >
              Définir comme valeur par défaut des nouvelles conversations
            </button>
          </div>

          <Slider
            label="temperature" value={settings.temperature} min={0} max={2} step={0.05}
            onChange={(v) => onChange({ temperature: v })}
            hint="0 = déterministe. Au-delà de 1,2 le modèle abliterated part vite en vrille."
          />
          <Slider
            label="top_p" value={settings.top_p} min={0.05} max={1} step={0.05}
            onChange={(v) => onChange({ top_p: v })}
          />
          <Slider
            label="max_tokens" value={settings.max_tokens} min={128} max={4096} step={128}
            onChange={(v) => onChange({ max_tokens: v })}
            hint={`~${(settings.max_tokens / 5.8 / 60).toFixed(1)} min à pleine longueur (5,8 tok/s). Réservé sur les ${CONTEXT_SIZE} tokens de contexte.`}
          />

          <div className="rounded-lg bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-500 ring-1 ring-neutral-800">
            Contexte serveur : {CONTEXT_SIZE} tokens, <code>--parallel 1</code>. Le compteur de contexte est une
            estimation recalibrée sur les <code>prompt_tokens</code> réellement renvoyés par le serveur.
          </div>
        </div>
      </aside>
    </>
  );
}
