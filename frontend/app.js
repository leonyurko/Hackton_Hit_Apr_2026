// ── IDENTITY ──────────────────────────────────────────────────────────────────
// Anonymous user ID — generated once, stored in localStorage forever.
function getOrCreateUserId() {
  let id = localStorage.getItem('eitan_user_id');
  if (!id) {
    id = crypto.randomUUID?.() || LocalMemory._uuid();
    localStorage.setItem('eitan_user_id', id);
  }
  return id;
}
const USER_ID = getOrCreateUserId();

// ── STATE ──────────────────────────────────────────────────────────────────────
let history      = [];          // [{ role, content }]
let module       = 'guide';
let sessionId    = null;        // current session ID (API mode)
let memoryEnabled = false;
let memoryMode   = 'api';       // 'api' | 'local'
let historyPeriod = 'week';

const MODULE_META = {
  guide: {
    title:       'Benefits Navigator',
    subtitle:    'Ask about your IDF rights, allowances & healthcare',
    welcome:     'Ask me anything about IDF rehabilitation rights, Bituach Leumi, healthcare coverage, or appeals.',
    placeholder: 'Ask about your benefits… (Enter to send)',
    icon:        '📋',
  },
  mind: {
    title:       'Mood Check-in',
    subtitle:    'Share how you\'re feeling — get personalised guidance',
    welcome:     'Tell me how you\'re feeling today. I\'ll suggest a coping technique tailored to your current state.',
    placeholder: 'How are you feeling today?… (Enter to send)',
    icon:        '🧠',
  },
  ptsd: {
    title:       'PTSD Support',
    subtitle:    'Grounded, validating support for trauma-related distress',
    welcome:     'אני כאן איתך. ספר לי מה אתה מרגיש עכשיו — בקצב שלך.',
    placeholder: 'מה עובר עליך?… (Enter to send)',
    icon:        '🕊️',
  },
};

// ── UTILS ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function getBackend() {
  const override = $('backend-url').value.trim();
  if (override) return override.replace(/\/$/, '');
  return '';
}

function md(raw) {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code>$1</code>')
    .replace(/^### (.+)$/gm,   '<h3>$1</h3>')
    .replace(/^[-•] (.+)$/gm,  '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n{2,}/g,        '</p><p>')
    .replace(/\n/g,            '<br>');
}

// ── RENDER ─────────────────────────────────────────────────────────────────────
function renderWelcome() {
  const meta = MODULE_META[module];
  $('messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${meta.icon}</div>
      <h3>${meta.title}</h3>
      <p>${meta.welcome}</p>
    </div>`;
  $('msg-input').placeholder = meta.placeholder;
}

function appendMsg(role, text, isError = false) {
  const welcome = $('messages').querySelector('.welcome');
  if (welcome) welcome.remove();

  const isUser = role === 'user';
  const row    = document.createElement('div');
  row.className = `msg-row ${isUser ? 'user' : 'ai'}`;

  const bubbleClass = isError ? 'error-bubble' : (isUser ? 'user-bubble' : 'ai-bubble');
  const content     = isUser
    ? text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    : `<p>${md(text)}</p>`;

  const playBtnHtml = (!isUser && !isError)
    ? `<button class="play-btn" onclick="playTTS(this, ${JSON.stringify(text).replace(/"/g, '&quot;')})">🔊 Read Aloud</button>`
    : '';

  row.innerHTML = `
    <div class="msg-avatar">${isUser ? '👤' : '🛡️'}</div>
    <div class="msg-content">
      <div class="msg-label">${isUser ? 'You' : 'Eitan AI'}</div>
      <div class="${bubbleClass}">${isError ? text : content}${playBtnHtml}</div>
    </div>`;

  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function showTyping()  { $('typing').style.display = 'block'; $('messages').scrollTop = $('messages').scrollHeight; }
function hideTyping()  { $('typing').style.display = 'none'; }

// ── MEMORY HELPERS ─────────────────────────────────────────────────────────────

async function apiStartSession() {
  try {
    const res = await fetch(`${getBackend()}/api/memory/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, module }),
    });
    if (!res.ok) return null;
    const { sessionId: sid } = await res.json();
    return sid;
  } catch { return null; }
}

async function apiEndSession(sid) {
  if (!sid) return;
  try {
    await fetch(`${getBackend()}/api/memory/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sid,
        userId: USER_ID,
        module,
        backend: $('model-select')?.value || 'nvidia',
      }),
    });
  } catch { /* non-critical */ }
}

async function localEndSession(sid) {
  if (!sid) return;
  await LocalMemory.endSession(sid, USER_ID, module, getBackend(), $('model-select')?.value || 'nvidia');
}

async function startMemorySession() {
  if (!memoryEnabled) return;
  if (memoryMode === 'api') {
    sessionId = await apiStartSession();
  } else {
    sessionId = LocalMemory.startSession(USER_ID, module);
  }
}

async function endMemorySession() {
  if (!memoryEnabled || !sessionId) return;
  if (memoryMode === 'api') {
    await apiEndSession(sessionId);
  } else {
    await localEndSession(sessionId);
  }
  sessionId = null;
}

function saveMessageLocal(role, content) {
  if (!memoryEnabled || memoryMode !== 'local' || !sessionId) return;
  LocalMemory.saveMessage(sessionId, USER_ID, role, content, module);
}

function buildMemoryContext() {
  if (!memoryEnabled || memoryMode !== 'local') return '';
  return LocalMemory.getMemoryContext(USER_ID, module);
}

// ── SEND ───────────────────────────────────────────────────────────────────────
async function send() {
  const input = $('msg-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';
  $('btn-send').disabled = true;

  appendMsg('user', text);
  history.push({ role: 'user', content: text });
  showTyping();

  // Save user message in local mode
  saveMessageLocal('user', text);

  try {
    const backendChoice = $('model-select')?.value || 'nvidia';
    const res = await fetch(`${getBackend()}/api/test/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message: text,
        module,
        history: history.slice(0, -1),
        backend: backendChoice,
        // Memory fields
        sessionId,
        userId:        USER_ID,
        memoryEnabled,
        memoryMode,
        memoryContext: buildMemoryContext(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const { reply } = await res.json();
    history.push({ role: 'assistant', content: reply });
    hideTyping();
    appendMsg('ai', reply);

    // Save assistant reply in local mode
    saveMessageLocal('assistant', reply);

  } catch (e) {
    hideTyping();
    history.pop();
    appendMsg('ai', `⚠️ ${e.message}`, true);
  } finally {
    $('btn-send').disabled = false;
    input.focus();
  }
}

// ── EVENTS ─────────────────────────────────────────────────────────────────────
$('btn-send').addEventListener('click', send);

$('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$('msg-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});

// Module switch
document.querySelectorAll('.module-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.module === module) return;

    // End current session before switching
    await endMemorySession();

    document.querySelectorAll('.module-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    module = btn.dataset.module;
    history = [];
    const meta = MODULE_META[module];
    $('chat-title').textContent    = meta.title;
    $('chat-subtitle').textContent = meta.subtitle;
    renderWelcome();

    // Start a new session for the new module
    await startMemorySession();
  });
});

// Clear conversation
$('btn-clear').addEventListener('click', async () => {
  await endMemorySession();
  history = [];
  renderWelcome();
  await startMemorySession();
});

// ── MEMORY UI EVENTS ───────────────────────────────────────────────────────────

const memoryToggle    = $('memory-enabled-toggle');
const memoryModeRow   = $('memory-mode-row');
const memoryHistoryBtn = $('btn-memory-history');
const memoryBadge     = $('memory-badge');
const memoryStatusText = $('memory-status-text');

function updateMemoryUI() {
  memoryModeRow.style.display    = memoryEnabled ? 'flex' : 'none';
  memoryHistoryBtn.style.display = memoryEnabled ? 'block' : 'none';
  memoryBadge.style.display      = memoryEnabled ? 'flex' : 'none';

  if (memoryEnabled) {
    const modeLabel = memoryMode === 'api' ? '☁️ API (Supabase)' : '💻 Local storage';
    memoryStatusText.textContent = `On — ${modeLabel}`;
  } else {
    memoryStatusText.textContent = 'Off — AI forgets after session';
  }
}

memoryToggle.addEventListener('change', async () => {
  const wasEnabled = memoryEnabled;
  memoryEnabled = memoryToggle.checked;
  updateMemoryUI();

  if (memoryEnabled && !wasEnabled) {
    await startMemorySession();
  } else if (!memoryEnabled && wasEnabled) {
    await endMemorySession();
  }
});

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.mode === memoryMode) return;

    // End current session in old mode
    await endMemorySession();

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    memoryMode = btn.dataset.mode;
    updateMemoryUI();

    // Start new session in new mode
    await startMemorySession();
  });
});

// ── HISTORY DRAWER ─────────────────────────────────────────────────────────────

const historyDrawer  = $('history-drawer');
const historyOverlay = $('history-overlay');

function openHistoryDrawer() {
  historyOverlay.style.display = 'block';
  historyDrawer.classList.add('open');
  renderHistoryList();
}

function closeHistoryDrawer() {
  historyOverlay.style.display = 'none';
  historyDrawer.classList.remove('open');
}

$('btn-memory-history').addEventListener('click', openHistoryDrawer);
$('btn-close-history').addEventListener('click', closeHistoryDrawer);
historyOverlay.addEventListener('click', closeHistoryDrawer);

// Period tabs
document.querySelectorAll('.history-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    historyPeriod = tab.dataset.period;
    renderHistoryList();
  });
});

async function fetchSessions() {
  if (memoryMode === 'local') {
    return LocalMemory.getProgress(USER_ID, historyPeriod);
  }
  try {
    const res = await fetch(`${getBackend()}/api/memory/progress/${USER_ID}?period=${historyPeriod}`);
    if (!res.ok) return [];
    const { sessions } = await res.json();
    return sessions;
  } catch { return []; }
}

const SENTIMENT_EMOJI = {
  anxious: '😰', low: '😔', agitated: '😤', exhausted: '😩', stable: '😊', mixed: '🌊',
};
const MODULE_LABELS = { guide: 'Benefits', mind: 'Mood', ptsd: 'PTSD' };

async function renderHistoryList() {
  const list = $('history-list');
  list.innerHTML = '<div class="history-empty">Loading…</div>';

  const sessions = await fetchSessions();

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="history-empty">No sessions in this period yet.</div>';
    return;
  }

  // Show newest first
  const sorted = [...sessions].reverse();

  list.innerHTML = '';
  sorted.forEach(s => {
    const card = document.createElement('div');
    card.className = 'session-card';

    const date = new Date(s.created_at).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const emoji    = SENTIMENT_EMOJI[s.sentiment] || '💬';
    const modLabel = MODULE_LABELS[s.module] || s.module;
    const topicsHtml = (s.key_topics || [])
      .map(t => `<span class="session-topic">${t}</span>`).join('');
    const isShared = s.is_shared_with_ai;
    const summaryText = s.summary || '<em style="color:var(--text3)">Summary generating…</em>';

    card.innerHTML = `
      <div class="session-card-top">
        <div class="session-card-meta">
          <span class="session-module-badge">${modLabel}</span>
          <span class="session-date">${date}</span>
          ${s.sentiment ? `<span class="session-sentiment sentiment-${s.sentiment}">${emoji} ${s.sentiment}</span>` : ''}
        </div>
        <button class="session-delete-btn" title="Delete this session">🗑</button>
      </div>
      <div class="session-summary">${summaryText}</div>
      ${topicsHtml ? `<div class="session-topics">${topicsHtml}</div>` : ''}
      <div class="session-card-actions">
        <label class="session-share-label${isShared ? ' shared' : ''}">
          <input type="checkbox" ${isShared ? 'checked' : ''} />
          ${isShared ? '✅ AI can see this session' : 'Share with AI'}
        </label>
        <span style="font-size:11px;color:var(--text3)">${s.message_count || 0} msgs · ${s.duration_minutes || 0} min</span>
      </div>`;

    // Toggle share
    const shareCheckbox = card.querySelector('input[type="checkbox"]');
    const shareLabel    = card.querySelector('.session-share-label');
    shareCheckbox.addEventListener('change', async () => {
      const shared = shareCheckbox.checked;
      shareLabel.classList.toggle('shared', shared);
      shareLabel.childNodes[1].textContent = shared ? ' ✅ AI can see this session' : ' Share with AI';

      if (memoryMode === 'local') {
        LocalMemory.toggleShare(s.session_id, USER_ID, shared);
      } else {
        try {
          await fetch(`${getBackend()}/api/memory/session/${s.session_id}/share`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, shared }),
          });
        } catch { /* non-critical */ }
      }
    });

    // Delete session
    card.querySelector('.session-delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete this session from memory?')) return;
      if (memoryMode === 'local') {
        LocalMemory.deleteSession(s.session_id, USER_ID);
      } else {
        try {
          await fetch(`${getBackend()}/api/memory/session/${s.session_id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID }),
          });
        } catch { /* non-critical */ }
      }
      card.remove();
      if ($('history-list').children.length === 0) {
        $('history-list').innerHTML = '<div class="history-empty">No sessions in this period yet.</div>';
      }
    });

    list.appendChild(card);
  });
}

// Delete all memory
$('btn-delete-all-memory').addEventListener('click', async () => {
  if (!confirm('Delete ALL session memory? This cannot be undone.')) return;
  if (memoryMode === 'local') {
    LocalMemory.deleteAllMemory(USER_ID);
  } else {
    try {
      await fetch(`${getBackend()}/api/memory/all/${USER_ID}`, { method: 'DELETE' });
    } catch { /* non-critical */ }
  }
  $('history-list').innerHTML = '<div class="history-empty">All memory deleted.</div>';
});

// ── BOOT ───────────────────────────────────────────────────────────────────────
renderWelcome();
updateMemoryUI();

// ── AUDIO / TTS / STT ──────────────────────────────────────────────────────────
async function playTTS(btn, text) {
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Loading...';
  btn.disabled = true;

  try {
    const res = await fetch(`${getBackend()}/api/audio/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('Failed to generate audio');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.onended = () => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    };

    btn.innerHTML = '🔊 Playing...';
    await audio.play();
  } catch (err) {
    console.error(err);
    alert('Failed to play audio');
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

const micBtn = $('btn-mic');

micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('mouseleave', stopRecording);
micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', stopRecording);

async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.addEventListener('dataavailable', event => {
      audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      micBtn.classList.remove('recording');
      micBtn.innerHTML = '⏳';
      micBtn.disabled = true;

      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice.webm');

      try {
        const res = await fetch(`${getBackend()}/api/audio/stt`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error('Transcription failed');
        const data = await res.json();

        const input = $('msg-input');
        input.value = (input.value + ' ' + data.text).trim();
        input.focus();
      } catch (err) {
        console.error(err);
        alert('Failed to transcribe audio.');
      } finally {
        micBtn.innerHTML = '🎤';
        micBtn.disabled = false;
      }
    });

    isRecording = true;
    micBtn.classList.add('recording');
    mediaRecorder.start();
  } catch (err) {
    console.error('Mic error:', err);
    alert('Microphone access denied or unavailable.');
  }
}

function stopRecording() {
  if (isRecording && mediaRecorder.state !== 'inactive') {
    isRecording = false;
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
}
