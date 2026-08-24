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
  const lines = textOf(children).replace(/\n$/, '').split('\n').length;

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
    <div className="frame my-3 border border-line bg-void">
      <div className="flex items-center justify-between border-b border-line bg-panel px-2 py-1">
        <span className="label readout text-acc">
          ▤ {lang ? lang.toUpperCase() : 'RAW'} <span className="text-faint">· {lines}L</span>
        </span>
        <button type="button" onClick={copy} className="label hover:text-acc">
          {copied ? '[ COPIÉ ✓ ]' : '[ COPIER ]'}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-3 text-[12.5px] leading-[1.65]">{children}</pre>
    </div>
  );
}
