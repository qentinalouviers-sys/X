import { useCallback, useEffect, useRef, useState } from 'react';
import { STATE, checkHealth, fetchModels } from '../lib/api.js';

const OK_INTERVAL = 15_000;
const RETRY_INTERVAL = 3_000; // model loading / server down: poll harder

export function useServerStatus() {
  const [status, setStatus] = useState({ state: STATE.UNKNOWN, detail: 'connexion…' });
  const [model, setModel] = useState(null);
  const timer = useRef(null);
  const modelFetched = useRef(false);

  const ping = useCallback(async () => {
    const health = await checkHealth().catch(() => ({ state: STATE.OFFLINE, detail: 'erreur' }));
    setStatus(health);

    if (health.state === STATE.ONLINE && !modelFetched.current) {
      modelFetched.current = true;
      fetchModels()
        .then((ids) => setModel(ids[0] ?? null))
        .catch(() => { modelFetched.current = false; });
    }
    if (health.state !== STATE.ONLINE) modelFetched.current = false;
    return health;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      const health = await ping();
      if (cancelled) return;
      const delay = health.state === STATE.ONLINE ? OK_INTERVAL : RETRY_INTERVAL;
      timer.current = setTimeout(loop, delay);
    };
    loop();

    // Coming back from a locked iPhone should refresh immediately.
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ping]);

  return { status, model, refresh: ping };
}
