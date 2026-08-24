import { CONTEXT_SIZE, logout } from '../lib/api.js';

function Dial({ label, value, min, max, step, onChange, hint, format = (v) => v }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="label text-acc">{label}</span>
        <span className="readout text-[12px] text-fg">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
        style={{ background: `linear-gradient(90deg, var(--color-acc) ${pct}%, var(--color-line) ${pct}%)` }}
      />
      {hint && <p className="hint mt-1.5">{hint}</p>}
    </label>
  );
}

export default function SettingsPanel({ open, onClose, settings, onChange, conversation, onSystemPromptChange }) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-void/80" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-line bg-pit">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="label text-acc glow">// CONFIGURATION</span>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto p-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="label text-acc">SYSTEM PROMPT</span>
              <span className="label text-faint">SESSION COURANTE</span>
            </div>
            <textarea
              value={conversation.systemPrompt ?? ''}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={7}
              className="field scrollbar-thin mt-2 w-full resize-y p-2 text-[12.5px]"
            />
            <button
              className="label mt-1.5 hover:text-acc"
              onClick={() => onChange({ systemPrompt: conversation.systemPrompt ?? '' })}
            >
              [ DÉFINIR COMME DÉFAUT ]
            </button>
          </div>

          <div className="rule" />

          <Dial
            label="TEMPERATURE" value={settings.temperature} min={0} max={2} step={0.05}
            onChange={(v) => onChange({ temperature: v })}
            format={(v) => v.toFixed(2)}
            hint="0 = déterministe. Au-delà de 1,20 le modèle abliterated part vite en vrille."
          />
          <Dial
            label="TOP_P" value={settings.top_p} min={0.05} max={1} step={0.05}
            onChange={(v) => onChange({ top_p: v })}
            format={(v) => v.toFixed(2)}
          />
          <Dial
            label="MAX_TOKENS" value={settings.max_tokens} min={128} max={4096} step={128}
            onChange={(v) => onChange({ max_tokens: v })}
            hint={`~${(settings.max_tokens / 5.8 / 60).toFixed(1)} min à pleine longueur (5,8 tok/s). Réservé sur les ${CONTEXT_SIZE} tokens de contexte.`}
          />

          <div className="rule" />

          <div className="border border-line bg-panel p-2.5">
            <div className="label mb-1.5 text-acc">// NŒUD</div>
            <dl className="hint space-y-1">
              <div className="flex justify-between"><dt>contexte</dt><dd className="readout text-dim">{CONTEXT_SIZE} tok</dd></div>
              <div className="flex justify-between"><dt>concurrence</dt><dd className="readout text-dim">--parallel 1</dd></div>
              <div className="flex justify-between"><dt>jauge ctx</dt><dd className="readout text-dim">estimée, recalibrée</dd></div>
            </dl>
          </div>

          <div className="rule" />

          <div className="space-y-2">
            <button onClick={() => logout()} className="btn btn-danger w-full">
              ⏻ TERMINER LA SESSION
            </button>
            <p className="hint">
              Les conversations restent stockées dans ce navigateur : la déconnexion ne les efface pas.
              Purgez-les depuis la barre latérale si l'appareil n'est pas le vôtre.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
