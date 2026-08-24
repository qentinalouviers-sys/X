import { useEffect, useState } from 'react';

/**
 * Service worker registration + the Chromium install prompt.
 *
 * The SW is registered only from inside the app, i.e. after login: an
 * anonymous visitor gets a 302 on /sw.js and there would be nothing to cache.
 */
export function usePwa() {
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('service worker non enregistré', err);
      });
    }

    const onPrompt = (e) => {
      e.preventDefault(); // keep the event so we can fire it from our own button
      setPrompt(e);
    };
    const onInstalled = () => setPrompt(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    // Safari never fires beforeinstallprompt: iOS installs via the share sheet.
    installable: Boolean(prompt),
    install: async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    },
  };
}

const FX_KEY = 'llm-chat:fx';

/** CRT scanlines and glow: gorgeous on a desktop, tiring on a phone. */
export function useFx() {
  const [fx, setFx] = useState(() => localStorage.getItem(FX_KEY) !== '0');

  useEffect(() => {
    document.documentElement.classList.toggle('fx-off', !fx);
    localStorage.setItem(FX_KEY, fx ? '1' : '0');
  }, [fx]);

  return [fx, () => setFx((v) => !v)];
}
