const { nvidiaChat, localChat } = require('../config/nvidia');

// ---------------------------------------------------------------------------
// Simple in-memory cache with TTL
// ---------------------------------------------------------------------------
class SimpleCache {
  constructor() {
    this.store = new Map();
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  delete(key) {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Priority Queue respecting 40 RPM (1 request per 1500ms)
// Priority: 0 = crisis (immediate), 1 = P1, 2 = P2 (default), 3 = P3 (background)
// ---------------------------------------------------------------------------
class AIQueue {
  constructor(rpmLimit = 40) {
    this.queue = [];
    this.processing = false;
    this.minIntervalMs = Math.ceil((60 * 1000) / rpmLimit); // 1500ms
    this.lastRequestTime = 0;
  }

  /**
   * Enqueue an AI call.
   * @param {Function} fn  Async function that makes the API call
   * @param {number}   priority  0 (crisis) → 3 (background)
   * @returns {Promise<any>}
   */
  enqueue(fn, priority = 2) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, priority, resolve, reject });
      // Sort ascending by priority so lowest number (most urgent) comes first
      this.queue.sort((a, b) => a.priority - b.priority);
      this._process();
    });
  }

  async _process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const elapsed = Date.now() - this.lastRequestTime;
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    const item = this.queue.shift();
    this.lastRequestTime = Date.now();

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.processing = false;
      this._process();
    }
  }
}

// ---------------------------------------------------------------------------
// AI Service — public API
// ---------------------------------------------------------------------------
const cache = new SimpleCache();
const queue = new AIQueue(40);

/**
 * Send a chat completion request to NVIDIA NIM.
 *
 * @param {Array}   messages     OpenAI-format messages array
 * @param {Object}  options
 * @param {number}  [options.priority=2]   Queue priority (0=crisis, 1=fast, 2=normal, 3=background)
 * @param {string}  [options.cacheKey]     If provided, response is cached under this key
 * @param {number}  [options.cacheTtlMs]   Cache TTL in milliseconds (default: 10 min)
 * @param {number}  [options.maxTokens=1024]
 * @param {number}  [options.temperature=0.7]
 * @returns {Promise<string>}  The assistant's reply text
 */
async function chat(messages, options = {}) {
  const {
    priority = 2,
    cacheKey = null,
    cacheTtlMs = 10 * 60 * 1000,
    maxTokens = 1024,
    temperature = 0.7,
    backend = 'nvidia',     // 'nvidia' | 'local'
  } = options;

  // Return cached result if available
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  // Pick backend. Local LM Studio bypasses the 40 RPM queue (no rate limit
  // when running on the user's own machine).
  const callBackend = backend === 'local'
    ? () => localChat(messages, { maxTokens, temperature })
    : () => nvidiaChat(messages, { maxTokens, temperature });

  const result = backend === 'local'
    ? await callBackend()
    : await queue.enqueue(callBackend, priority);

  if (cacheKey && result) {
    cache.set(cacheKey, result, cacheTtlMs);
  }

  return result;
}

/**
 * Parse a JSON response from the AI safely.
 * Strips markdown code fences if present.
 * @param {string} text
 * @returns {any}
 */
function parseJSON(text) {
  // Strip ```json ... ``` or ``` ... ``` wrappers
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Invalidate a cache entry by key.
 */
function invalidateCache(key) {
  cache.delete(key);
}

module.exports = { chat, parseJSON, invalidateCache };
