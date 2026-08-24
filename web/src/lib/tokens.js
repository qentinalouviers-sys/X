import { CONTEXT_SIZE } from './api.js';

const CALIBRATION_KEY = 'llm-chat:chars-per-token';
const DEFAULT_CHARS_PER_TOKEN = 3.6; // rough Qwen/BPE average over FR+EN+code
const PER_MESSAGE_OVERHEAD = 4;      // chat template role markers

let charsPerToken = readCalibration();

function readCalibration() {
  const raw = Number(localStorage.getItem(CALIBRATION_KEY));
  return raw > 1.5 && raw < 8 ? raw : DEFAULT_CHARS_PER_TOKEN;
}

/**
 * The only exact tokenizer lives in llama-server, and calling /tokenize would
 * queue behind generation on a --parallel 1 server. So: heuristic, then
 * recalibrated from the real prompt_tokens the server reports after each turn.
 */
export function calibrate(promptChars, promptTokens) {
  if (!promptTokens || promptChars < 200) return;
  const ratio = promptChars / promptTokens;
  if (ratio < 1.5 || ratio > 8) return;
  charsPerToken = charsPerToken * 0.7 + ratio * 0.3; // smooth, avoid jitter
  localStorage.setItem(CALIBRATION_KEY, String(charsPerToken));
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

export function estimateMessages(messages) {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD,
    3
  );
}

export function contextUsage(messages, maxTokens) {
  const prompt = estimateMessages(messages);
  const reserved = Math.max(0, maxTokens || 0);
  return {
    prompt,
    reserved,
    total: CONTEXT_SIZE,
    ratio: prompt / CONTEXT_SIZE,
    // The server silently truncates the prompt past ctx-size; warn *before*.
    willOverflow: prompt + reserved > CONTEXT_SIZE,
    isTight: prompt / CONTEXT_SIZE >= 0.8,
  };
}
