import { useCallback, useRef, useState } from 'react';

function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

function languageOf(children) {
  const code = Array.isArray(children) ? children[0] : children;
  const cls = code?.props?.className || '';
  return cls.match(/language-([\w+-]+)/)?.[1] ?? '';
}

export default function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const lang = languageOf(children);

  const copy = useCallback(async () => {
    const text = textOf(children);
    try {
      // navigator.clipboard needs a secure context; over plain http on the LAN
      // only localhost qualifies, hence the textarea fallback.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [children]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-500">{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
        >
          {copied ? 'Copié ✓' : 'Copier'}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-3 text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}
