const KEY = 'llm-chat:state:v1';

export const DEFAULT_SETTINGS = {
  systemPrompt: 'Tu es un assistant concis et direct. Réponds en français.',
  temperature: 0.7,
  top_p: 0.95,
  max_tokens: 1024,
};

export function newConversation(settings) {
  return {
    id: crypto.randomUUID(),
    title: 'Nouvelle conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    systemPrompt: settings?.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt,
    messages: [],
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.conversations)) return null;
    return {
      conversations: parsed.conversations,
      currentId: parsed.currentId ?? parsed.conversations[0]?.id ?? null,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    // QuotaExceededError: localStorage is ~5 MB, i.e. a lot of conversations.
    console.warn('persistance impossible', err);
    return false;
  }
}

export function deriveTitle(text) {
  const clean = (text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'Nouvelle conversation';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}
