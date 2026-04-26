/**
 * memory-local.js — LocalStorage-based memory (offline / no-cloud mode)
 *
 * Mirrors the Supabase API but stores everything in localStorage.
 * Used when the user selects "💻 Local" storage mode.
 *
 * Storage keys:
 *   eitan_user_id            — anonymous UUID
 *   eitan_sessions           — { [sessionId]: SessionSummary }
 *   eitan_messages_<sid>     — Message[]
 */

class LocalMemory {
  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Return (or generate) the persistent anonymous user ID.
   */
  static getUserId() {
    let id = localStorage.getItem('eitan_user_id');
    if (!id) {
      id = LocalMemory._uuid();
      localStorage.setItem('eitan_user_id', id);
    }
    return id;
  }

  // ── Session Management ────────────────────────────────────────────────────

  static startSession(userId, module) {
    const sessionId = LocalMemory._uuid();
    const sessions  = LocalMemory._getSessions();
    sessions[sessionId] = {
      session_id:        sessionId,
      user_id:           userId,
      module,
      summary:           null,
      sentiment:         null,
      key_topics:        [],
      message_count:     0,
      duration_minutes:  0,
      is_shared_with_ai: false,
      created_at:        new Date().toISOString(),
      ended:             false,
    };
    LocalMemory._saveSessions(sessions);
    localStorage.setItem(`eitan_messages_${sessionId}`, JSON.stringify([]));
    return sessionId;
  }

  static saveMessage(sessionId, userId, role, content, module) {
    const key      = `eitan_messages_${sessionId}`;
    const messages = JSON.parse(localStorage.getItem(key) || '[]');
    messages.push({ role, content, module, created_at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(messages));

    // update count
    const sessions = LocalMemory._getSessions();
    if (sessions[sessionId]) {
      sessions[sessionId].message_count = messages.length;
      LocalMemory._saveSessions(sessions);
    }
  }

  static getSessionMessages(sessionId) {
    return JSON.parse(localStorage.getItem(`eitan_messages_${sessionId}`) || '[]');
  }

  /**
   * Summarize locally using the backend AI endpoint (summary is generated server-side,
   * but the result is stored in localStorage, not Supabase).
   * Falls back to a simple template if the API call fails.
   */
  static async endSession(sessionId, userId, module, backendUrl = '', backendChoice = 'nvidia') {
    const messages = LocalMemory.getSessionMessages(sessionId);
    if (messages.length === 0) return null;

    const sessions = LocalMemory._getSessions();
    const session  = sessions[sessionId];
    if (!session) return null;

    // Calculate duration
    const startMs  = new Date(session.created_at).getTime();
    const durationMinutes = Math.round((Date.now() - startMs) / 60000);

    let summaryData = {
      summary:    `${module} session with ${messages.filter(m=>m.role==='user').length} user messages.`,
      sentiment:  'mixed',
      key_topics: [],
    };

    try {
      // Use backend summarizer (same /api/memory/session/end endpoint)
      const res = await fetch(`${backendUrl}/api/memory/session/end`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId: '__local_summary__',
          userId,
          module,
          backend: backendChoice,
          // we pass messages directly for local mode summarization
          _localMessages: messages,
        }),
      });
      if (res.ok) {
        const { summary: srv } = await res.json();
        if (srv) summaryData = srv;
      }
    } catch { /* use fallback */ }

    sessions[sessionId] = {
      ...session,
      summary:          summaryData.summary,
      sentiment:        summaryData.sentiment,
      key_topics:       summaryData.key_topics || [],
      duration_minutes: durationMinutes,
      ended:            true,
    };
    LocalMemory._saveSessions(sessions);
    return sessions[sessionId];
  }

  // ── Memory Context for AI ─────────────────────────────────────────────────

  /**
   * Build context string from past shared sessions.
   */
  static getMemoryContext(userId, module, limit = 5) {
    const sessions = LocalMemory._getSessions();
    const shared = Object.values(sessions)
      .filter(s => s.user_id === userId && s.is_shared_with_ai && s.ended && s.summary)
      .filter(s => !module || module === 'all' || s.module === module)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit)
      .reverse();

    if (shared.length === 0) return '';

    const lines = shared.map(s => {
      const date   = new Date(s.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      const topics = s.key_topics?.length ? ` Topics: ${s.key_topics.join(', ')}.` : '';
      return `• [${date}] (${s.module}, mood: ${s.sentiment})${topics} — ${s.summary}`;
    });

    return `[MEMORY — Previous sessions the user has shared with you — do NOT bring these up proactively]:
${lines.join('\n')}`;
  }

  // ── Session List ──────────────────────────────────────────────────────────

  static listSessions(userId) {
    const sessions = LocalMemory._getSessions();
    return Object.values(sessions)
      .filter(s => s.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  static getProgress(userId, period = 'week') {
    let since = new Date();
    if (period === 'week')  since.setDate(since.getDate() - 7);
    if (period === 'month') since.setMonth(since.getMonth() - 1);
    if (period === 'all')   since = new Date(0);

    const sessions = LocalMemory._getSessions();
    return Object.values(sessions)
      .filter(s => s.user_id === userId && new Date(s.created_at) >= since)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  static toggleShare(sessionId, userId, shared) {
    const sessions = LocalMemory._getSessions();
    if (sessions[sessionId] && sessions[sessionId].user_id === userId) {
      sessions[sessionId].is_shared_with_ai = shared;
      LocalMemory._saveSessions(sessions);
    }
  }

  static deleteSession(sessionId, userId) {
    const sessions = LocalMemory._getSessions();
    if (sessions[sessionId]?.user_id === userId) {
      delete sessions[sessionId];
      LocalMemory._saveSessions(sessions);
      localStorage.removeItem(`eitan_messages_${sessionId}`);
    }
  }

  static deleteAllMemory(userId) {
    const sessions = LocalMemory._getSessions();
    Object.keys(sessions).forEach(sid => {
      if (sessions[sid].user_id === userId) {
        localStorage.removeItem(`eitan_messages_${sid}`);
        delete sessions[sid];
      }
    });
    LocalMemory._saveSessions(sessions);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  static _getSessions() {
    try { return JSON.parse(localStorage.getItem('eitan_sessions') || '{}'); }
    catch { return {}; }
  }

  static _saveSessions(sessions) {
    localStorage.setItem('eitan_sessions', JSON.stringify(sessions));
  }

  static _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}

// Also expose a helper to get-or-create the userId at page load
window.LocalMemory = LocalMemory;
