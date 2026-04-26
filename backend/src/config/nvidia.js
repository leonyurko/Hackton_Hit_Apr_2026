/**
 * Chat-completions clients (OpenAI-compatible) — NVIDIA NIM + local LM Studio.
 *
 * Uses plain fetch (Node 18+). The OpenAI SDK adds headers / request shaping
 * that can cause 403s on NVIDIA's free tier; plain fetch matches what the
 * official docs recommend.
 *
 * Retry policy:
 *   - Retry 502 / 503 / 504 and timeout (transient pod cycling)
 *   - Surface 401 / 403 / 429 immediately (auth / rate-limit, not transient)
 *   - Max 3 attempts, ~1 s constant backoff
 */

if (!process.env.NVIDIA_API_KEY) {
  throw new Error('Missing NVIDIA_API_KEY environment variable');
}

// ── NVIDIA (cloud, free tier) ───────────────────────────────────────────────
const NVIDIA_URL =
  (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '') +
  '/chat/completions';

const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || 'meta/llama-4-maverick-17b-128e-instruct';

// ── Local LM Studio (laptop, OpenAI-compat) ─────────────────────────────────
// LM Studio defaults to http://localhost:1234. If you serve from another
// machine over Tailscale / LAN, override via LOCAL_BASE_URL.
// Auth is unused locally but the header is still required, so we send a stub.
const LOCAL_URL =
  (process.env.LOCAL_BASE_URL || 'http://localhost:1234/v1').replace(/\/$/, '') +
  '/chat/completions';

const LOCAL_MODEL = process.env.LOCAL_MODEL || 'auto';
const LOCAL_KEY = process.env.LOCAL_API_KEY || 'lm-studio';

const TRANSIENT_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;


/**
 * Internal: call any OpenAI-compatible chat completions endpoint.
 *
 * @param {string} url
 * @param {string} model
 * @param {string} apiKey
 * @param {Array}  messages
 * @param {Object} opts
 * @returns {Promise<string>}  Assistant reply text
 */
async function _doChat(url, model, apiKey, messages, opts = {}) {
  const { maxTokens = 1024, temperature = 0.7, stream = false } = opts;

  const payload = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  });

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Transient — retry
      if (TRANSIENT_CODES.has(res.status) && attempt < MAX_RETRIES - 1) {
        console.warn(`[chat] Transient ${res.status} on attempt ${attempt + 1}, retrying…`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      // Surface auth / rate-limit immediately
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`Chat API error ${res.status}: ${body}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? '';

    } catch (err) {
      // Surface the real cause — node's undici wraps low-level network errors
      // as a generic "fetch failed", but err.cause has the actual code.
      const cause = err.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : '';
      console.warn(`[chat] Attempt ${attempt + 1}/${MAX_RETRIES} on ${url} failed: ${err.message}${cause}`);

      if (err.name === 'AbortError') {
        lastError = new Error('Chat API request timed out');
        if (attempt < MAX_RETRIES - 1) { await sleep(RETRY_DELAY_MS); continue; }
      }
      // Don't retry auth / rate-limit errors
      if (err.status === 401 || err.status === 403 || err.status === 429) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}


/**
 * NVIDIA chat completions (cloud, free tier — Llama 4 Maverick by default).
 */
async function nvidiaChat(messages, opts = {}) {
  return _doChat(NVIDIA_URL, NVIDIA_MODEL, process.env.NVIDIA_API_KEY, messages, opts);
}


/**
 * Local chat completions (LM Studio on laptop / LAN, any OpenAI-compat backend).
 */
async function localChat(messages, opts = {}) {
  return _doChat(LOCAL_URL, LOCAL_MODEL, LOCAL_KEY, messages, opts);
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  nvidiaChat,
  localChat,
  NVIDIA_MODEL,
  LOCAL_URL,
  LOCAL_MODEL,
};
