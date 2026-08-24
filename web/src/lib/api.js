export const CONTEXT_SIZE = 8192;

/**
 * The session cookie is HttpOnly, so the front cannot inspect it; a 401 is the
 * only signal that it expired. Bounce to the login form and come back here.
 */
function requireSession(res) {
  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/auth/login?next=${next}`;
    throw new Error('session expirée');
  }
  return res;
}

export function logout() {
  return fetch('/auth/logout', { method: 'POST' }).finally(() => {
    location.href = '/auth/login';
  });
}

/** Normalized server states used across the UI. */
export const STATE = {
  UNKNOWN: 'unknown',
  ONLINE: 'online',
  LOADING: 'loading',
  OFFLINE: 'offline',
};

/**
 * llama-server answers /health with 200 {"status":"ok"} once the model is
 * resident, and 503 {"error":{"message":"Loading model"}} for the ~2 minutes
 * it takes to mmap 11 GB. A proxy-level 502 means llama-server is not up.
 */
export async function checkHealth(signal) {
  let res;
  try {
    res = await fetch('/api/health', { signal, cache: 'no-store' });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return { state: STATE.OFFLINE, detail: 'serveur injoignable' };
  }
  requireSession(res);
  if (res.ok) return { state: STATE.ONLINE, detail: 'prêt' };
  if (res.status === 503) return { state: STATE.LOADING, detail: 'chargement du modèle…' };
  if (res.status === 502) return { state: STATE.OFFLINE, detail: 'llama-server hors ligne' };
  return { state: STATE.OFFLINE, detail: `HTTP ${res.status}` };
}

export async function fetchModels(signal) {
  const res = requireSession(await fetch('/api/v1/models', { signal, cache: 'no-store' }));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => m.id).filter(Boolean);
}

/** Resolves once the backend reports ONLINE, or throws after `timeoutMs`. */
export async function waitUntilReady({ timeoutMs = 300_000, intervalMs = 3000, signal, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const health = await checkHealth(signal);
    onTick?.(health);
    if (health.state === STATE.ONLINE) return health;
    if (Date.now() > deadline) throw new Error('Le modèle ne répond toujours pas après 5 minutes.');
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  }
}

/**
 * POST /v1/chat/completions with stream:true and yield the deltas.
 *
 * Deliberately no client-side timeout: at ~5.8 tok/s a 1000-token answer is a
 * three-minute request. Cancellation is the caller's AbortController only.
 */
export async function* streamChat({ messages, model, params, signal }) {
  const body = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: params.temperature,
    top_p: params.top_p,
    max_tokens: params.max_tokens,
  };

  const post = (payload) =>
    fetch('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload),
    });

  let res = requireSession(await post(body));
  if (res.status === 400) {
    // Builds without stream_options reject the whole request; retry plainly
    // and give up on the exact token accounting rather than on the answer.
    const { stream_options, ...fallback } = body;
    res = await post(fallback);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const err = new Error(parseUpstreamError(text) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep the trailing partial one.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') return;

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // never let a malformed frame kill the stream
        }
        if (json.error) throw new Error(json.error.message || 'erreur du serveur');

        const choice = json.choices?.[0];
        yield {
          content: choice?.delta?.content || '',
          reasoning: choice?.delta?.reasoning_content || '',
          finishReason: choice?.finish_reason || null,
          usage: json.usage || null,
        };
      }
    }
  }
}

function parseUpstreamError(text) {
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || null;
  } catch {
    return text?.slice(0, 300) || null;
  }
}
