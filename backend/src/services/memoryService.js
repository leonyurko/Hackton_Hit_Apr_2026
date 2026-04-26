/**
 * memoryService.js
 * Consensual Trauma Memory — Supabase-backed session persistence.
 *
 * Design principles:
 *  - AI never brings up past sessions on its own.
 *  - User controls which sessions are shared with AI via is_shared_with_ai flag.
 *  - Real-time: every message is written to session_messages immediately.
 *  - At session end, an AI-generated summary is saved to session_summaries.
 */

const supabase = require('../config/supabase');
const { chat } = require('./aiService');

// ─── Session Management ───────────────────────────────────────────────────────

/**
 * Start a new session.
 * @param {string} userId  Anonymous UUID (stored in localStorage on client)
 * @param {string} module  'guide' | 'mind' | 'ptsd'
 * @returns {Promise<string>} session_id
 */
async function startSession(userId, module) {
  const { data, error } = await supabase
    .from('session_messages')
    .insert({ user_id: userId, module, role: '__session_start__', content: '' })
    .select('session_id')
    .single();

  if (error) throw error;
  return data.session_id;
}

/**
 * Save a single message in real-time.
 * @param {string} sessionId
 * @param {string} userId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {string} module
 */
async function saveMessage(sessionId, userId, role, content, module) {
  const { error } = await supabase.from('session_messages').insert({
    session_id: sessionId,
    user_id:    userId,
    role,
    content,
    module,
  });
  if (error) throw error;
}

/**
 * Get all messages for a session.
 */
async function getSessionMessages(sessionId) {
  const { data, error } = await supabase
    .from('session_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .neq('role', '__session_start__')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * End a session: generate an AI summary and save to session_summaries.
 * @param {string} sessionId
 * @param {string} userId
 * @param {string} module
 * @param {string} backendChoice  'nvidia' | 'local'
 * @returns {Promise<object>} The saved summary row
 */
async function endSession(sessionId, userId, module, backendChoice = 'nvidia') {
  const messages = await getSessionMessages(sessionId);
  if (messages.length === 0) return null;

  // Build a compact transcript for the summarizer
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const summaryPrompt = [
    {
      role: 'system',
      content: `You are a clinical session summarizer for a trauma-support AI.
Given a session transcript, extract:
1. A 2-3 sentence empathetic summary of what was discussed (NOT diagnostic).
2. The dominant emotional tone: one of anxious|low|agitated|exhausted|stable|mixed.
3. Up to 5 key topics as short phrases (e.g. "sleep issues", "hypervigilance", "benefits question").

Respond ONLY with valid JSON (no markdown fences):
{
  "summary": "...",
  "sentiment": "anxious|low|agitated|exhausted|stable|mixed",
  "key_topics": ["topic1", "topic2"]
}`,
    },
    {
      role: 'user',
      content: `Module: ${module}\n\nTranscript:\n${transcript.slice(0, 6000)}`,
    },
  ];

  let summaryData = {
    summary:    'Session completed.',
    sentiment:  'mixed',
    key_topics: [],
  };

  try {
    const raw = await chat(summaryPrompt, { priority: 3, maxTokens: 512, backend: backendChoice });
    // Strip markdown fences if any
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed  = JSON.parse(cleaned);
    summaryData   = {
      summary:    parsed.summary    || summaryData.summary,
      sentiment:  parsed.sentiment  || summaryData.sentiment,
      key_topics: parsed.key_topics || summaryData.key_topics,
    };
  } catch { /* fallback to defaults — non-critical */ }

  const startTime = messages[0]?.created_at ? new Date(messages[0].created_at) : new Date();
  const endTime   = new Date();
  const durationMinutes = Math.round((endTime - startTime) / 60000);

  const { data, error } = await supabase
    .from('session_summaries')
    .insert({
      session_id:        sessionId,
      user_id:           userId,
      module,
      summary:           summaryData.summary,
      sentiment:         summaryData.sentiment,
      key_topics:        summaryData.key_topics,
      message_count:     messages.length,
      duration_minutes:  durationMinutes,
      is_shared_with_ai: false, // user must explicitly opt-in
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Memory Context for AI ────────────────────────────────────────────────────

/**
 * Build a memory context string from past sessions that the user has shared.
 * Injected into the system prompt only when memoryEnabled=true.
 * @param {string} userId
 * @param {string} module   Filter to relevant module, or 'all'
 * @param {number} limit    Max sessions to include
 * @returns {Promise<string>}  Ready-to-inject context block, or ''
 */
async function getMemoryContext(userId, module, limit = 5) {
  let query = supabase
    .from('session_summaries')
    .select('module, summary, sentiment, key_topics, created_at')
    .eq('user_id', userId)
    .eq('is_shared_with_ai', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (module && module !== 'all') {
    query = query.eq('module', module);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return '';

  const lines = data
    .reverse()
    .map(s => {
      const date = new Date(s.created_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      const topics = s.key_topics?.length ? ` Topics: ${s.key_topics.join(', ')}.` : '';
      return `• [${date}] (${s.module}, mood: ${s.sentiment})${topics} — ${s.summary}`;
    });

  return `[MEMORY — Previous sessions the user has shared with you — do NOT bring these up proactively; only reference them if the user asks or it is directly relevant]:
${lines.join('\n')}`;
}

// ─── Progress Report ──────────────────────────────────────────────────────────

/**
 * Get session summaries for a user within a time period.
 * @param {string} userId
 * @param {'week'|'month'|'all'} period
 */
async function getProgress(userId, period = 'week') {
  let since = new Date();
  if (period === 'week')  since.setDate(since.getDate() - 7);
  if (period === 'month') since.setMonth(since.getMonth() - 1);
  if (period === 'all')   since = new Date(0);

  const { data, error } = await supabase
    .from('session_summaries')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ─── Session List ─────────────────────────────────────────────────────────────

/**
 * List all session summaries for a user (for the history panel).
 */
async function listSessions(userId) {
  const { data, error } = await supabase
    .from('session_summaries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Toggle is_shared_with_ai for a session.
 */
async function toggleShare(sessionId, userId, shared) {
  const { error } = await supabase
    .from('session_summaries')
    .update({ is_shared_with_ai: shared })
    .eq('session_id', sessionId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * Delete all messages and summaries for a session.
 */
async function deleteSession(sessionId, userId) {
  await supabase.from('session_messages').delete().eq('session_id', sessionId).eq('user_id', userId);
  await supabase.from('session_summaries').delete().eq('session_id', sessionId).eq('user_id', userId);
}

/**
 * Delete ALL memory for a user.
 */
async function deleteAllMemory(userId) {
  await supabase.from('session_messages').delete().eq('user_id', userId);
  await supabase.from('session_summaries').delete().eq('user_id', userId);
}

module.exports = {
  startSession,
  saveMessage,
  getSessionMessages,
  endSession,
  getMemoryContext,
  getProgress,
  listSessions,
  toggleShare,
  deleteSession,
  deleteAllMemory,
};
