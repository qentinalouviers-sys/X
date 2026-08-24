import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat, waitUntilReady } from '../lib/api.js';
import { calibrate } from '../lib/tokens.js';
import { deriveTitle } from '../lib/storage.js';

const CONTINUE_NUDGE =
  "Continue exactement là où tu t'es arrêté, sans répéter le texte déjà écrit et sans préambule.";

const msg = (role, content, extra = {}) => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: Date.now(),
  ...extra,
});

/**
 * Owns everything about an in-flight generation.
 *
 * The streaming text lives here, *not* in the persisted conversation: at one
 * React state update per token over the whole conversation tree we would be
 * cloning + re-serializing the store ~6 times a second for nothing. It is
 * committed back into the conversation when the stream ends, aborts or fails.
 */
export function useChat({ conversation, updateConversation, settings, model, refreshStatus }) {
  const [live, setLive] = useState(null); // { messageId, content, reasoning, tokens, startedAt }
  const [waitingForModel, setWaitingForModel] = useState(false);
  const [now, setNow] = useState(0);
  const abortRef = useRef(null);
  const bufferRef = useRef(null);

  const isStreaming = live !== null || waitingForModel;

  // Drives the elapsed-time readout without coupling it to token arrival.
  useEffect(() => {
    if (!isStreaming) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isStreaming]);

  const commit = useCallback(
    (convId, messageId, patch) => {
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch, streaming: false } : m)),
      }));
    },
    [updateConversation]
  );

  /**
   * @param apiMessages  what we actually send upstream
   * @param targetId     assistant message being filled
   * @param seed         text already present on that message (continue/resume)
   */
  const run = useCallback(
    async (convId, apiMessages, targetId, seed = '') => {
      const controller = new AbortController();
      abortRef.current = controller;
      bufferRef.current = { content: seed, reasoning: '', tokens: 0, startedAt: Date.now() };
      setLive({ messageId: targetId, ...bufferRef.current });

      const promptChars = apiMessages.reduce((n, m) => n + m.content.length, 0);
      let finishReason = null;
      let usage = null;
      let failure = null;
      let aborted = false;

      const consume = async () => {
        for await (const delta of streamChat({
          messages: apiMessages,
          model,
          params: settings,
          signal: controller.signal,
        })) {
          const b = bufferRef.current;
          if (delta.content) {
            b.content += delta.content;
            b.tokens += 1; // llama.cpp emits one SSE frame per token
          }
          if (delta.reasoning) b.reasoning += delta.reasoning;
          if (delta.finishReason) finishReason = delta.finishReason;
          if (delta.usage) usage = delta.usage;
          setLive({ messageId: targetId, ...b });
        }
      };

      try {
        try {
          await consume();
        } catch (err) {
          // Cold start: llama-server needs ~2 min to load 11 GB after a reboot.
          if (err.status === 503 && !controller.signal.aborted) {
            setWaitingForModel(true);
            await waitUntilReady({ signal: controller.signal });
            setWaitingForModel(false);
            await consume();
          } else {
            throw err;
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || controller.signal.aborted) aborted = true;
        else failure = err.message || String(err);
      } finally {
        setWaitingForModel(false);
      }

      const b = bufferRef.current;
      const elapsed = Math.max(1, Date.now() - b.startedAt);
      const tokens = usage?.completion_tokens || b.tokens;
      if (usage?.prompt_tokens) calibrate(promptChars, usage.prompt_tokens);

      commit(convId, targetId, {
        content: b.content,
        reasoning: b.reasoning || undefined,
        finishReason: aborted ? 'aborted' : finishReason,
        error: failure,
        // Empty + failed means nothing was salvaged; empty + aborted is a no-op.
        interrupted: aborted || Boolean(failure),
        stats: tokens ? { tokens, ms: elapsed, tps: tokens / (elapsed / 1000) } : undefined,
      });

      abortRef.current = null;
      bufferRef.current = null;
      setLive(null);
      if (failure) refreshStatus?.();
    },
    [commit, model, settings, refreshStatus]
  );

  const buildApiMessages = useCallback(
    (messages, extra = []) => {
      const out = [];
      const system = conversation.systemPrompt?.trim();
      if (system) out.push({ role: 'system', content: system });
      for (const m of messages) {
        if (!m.content?.trim()) continue;
        out.push({ role: m.role, content: m.content });
      }
      return out.concat(extra);
    },
    [conversation.systemPrompt]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    (text) => {
      if (isStreaming || !text.trim()) return;
      const convId = conversation.id;
      const userMsg = msg('user', text.trim());
      const assistant = msg('assistant', '', { streaming: true });
      const history = [...conversation.messages, userMsg];

      updateConversation(convId, (c) => ({
        ...c,
        title: c.messages.length === 0 ? deriveTitle(text) : c.title,
        messages: [...c.messages, userMsg, assistant],
      }));
      run(convId, buildApiMessages(history), assistant.id);
    },
    [buildApiMessages, conversation, isStreaming, run, updateConversation]
  );

  /** Re-run the last assistant turn from scratch. */
  const regenerate = useCallback(() => {
    if (isStreaming) return;
    const convId = conversation.id;
    const idx = conversation.messages.map((m) => m.role).lastIndexOf('assistant');
    if (idx < 0) return;
    const target = conversation.messages[idx];
    const history = conversation.messages.slice(0, idx);

    updateConversation(convId, (c) => ({
      ...c,
      messages: c.messages.map((m, i) =>
        i === idx ? { ...m, content: '', reasoning: undefined, error: null, finishReason: null, stats: undefined, streaming: true } : m
      ),
    }));
    run(convId, buildApiMessages(history), target.id);
  }, [buildApiMessages, conversation, isStreaming, run, updateConversation]);

  /**
   * Resume a `length`-truncated or network-interrupted answer.
   *
   * The chat endpoint always closes the assistant turn, so there is no true
   * "continue this completion" here: we append a throwaway user instruction
   * that is never persisted, and concatenate the new text onto the message.
   */
  const continueMessage = useCallback(
    (messageId) => {
      if (isStreaming) return;
      const convId = conversation.id;
      const idx = conversation.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const target = conversation.messages[idx];
      const history = conversation.messages.slice(0, idx + 1);

      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, error: null, finishReason: null, streaming: true } : m
        ),
      }));
      run(
        convId,
        buildApiMessages(history, [{ role: 'user', content: CONTINUE_NUDGE }]),
        messageId,
        target.content ? `${target.content} ` : ''
      );
    },
    [buildApiMessages, conversation, isStreaming, run, updateConversation]
  );

  /** Edit one of my messages and restart the conversation from there. */
  const editAndResend = useCallback(
    (messageId, text) => {
      if (isStreaming || !text.trim()) return;
      const convId = conversation.id;
      const idx = conversation.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;

      const edited = { ...conversation.messages[idx], content: text.trim() };
      const history = [...conversation.messages.slice(0, idx), edited];
      const assistant = msg('assistant', '', { streaming: true });

      updateConversation(convId, (c) => ({ ...c, messages: [...history, assistant] }));
      run(convId, buildApiMessages(history), assistant.id);
    },
    [buildApiMessages, conversation, isStreaming, run, updateConversation]
  );

  const liveStats = live
    ? {
        tokens: live.tokens,
        elapsed: Math.max(0, (now || Date.now()) - live.startedAt),
        tps: live.tokens / Math.max(0.001, ((now || Date.now()) - live.startedAt) / 1000),
      }
    : null;

  return {
    live,
    liveStats,
    isStreaming,
    waitingForModel,
    send,
    stop,
    regenerate,
    continueMessage,
    editAndResend,
  };
}
