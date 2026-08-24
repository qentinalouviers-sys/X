import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, loadState, newConversation, saveState } from '../lib/storage.js';

export function useConversations() {
  const [state, setState] = useState(() => {
    const restored = loadState();
    if (restored?.conversations?.length) return restored;
    const settings = restored?.settings ?? DEFAULT_SETTINGS;
    const conv = newConversation(settings);
    return { conversations: [conv], currentId: conv.id, settings };
  });

  // Persist off the render path: writing 5 MB of JSON on every token would
  // stall the main thread far more than the model does.
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveState(state), 400);
    return () => clearTimeout(timer.current);
  }, [state]);
  useEffect(() => {
    const flush = () => saveState(state);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [state]);

  const current = useMemo(
    () => state.conversations.find((c) => c.id === state.currentId) ?? state.conversations[0],
    [state]
  );

  const updateConversation = useCallback((id, updater) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...updater(c), updatedAt: Date.now() } : c
      ),
    }));
  }, []);

  const createConversation = useCallback(() => {
    setState((prev) => {
      const conv = newConversation(prev.settings);
      return { ...prev, conversations: [conv, ...prev.conversations], currentId: conv.id };
    });
  }, []);

  const deleteConversation = useCallback((id) => {
    setState((prev) => {
      const rest = prev.conversations.filter((c) => c.id !== id);
      if (!rest.length) {
        const conv = newConversation(prev.settings);
        return { ...prev, conversations: [conv], currentId: conv.id };
      }
      return { ...prev, conversations: rest, currentId: prev.currentId === id ? rest[0].id : prev.currentId };
    });
  }, []);

  const selectConversation = useCallback((id) => {
    setState((prev) => ({ ...prev, currentId: id }));
  }, []);

  const updateSettings = useCallback((patch) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  return {
    conversations: state.conversations,
    current,
    settings: state.settings,
    createConversation,
    deleteConversation,
    selectConversation,
    updateConversation,
    updateSettings,
  };
}
