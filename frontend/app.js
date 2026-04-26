// ── STATE ──────────────────────────────────────────────────────────────────
let history = [];   // [{ role, content }]
let module  = 'guide';

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

// ── UTILS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function getBackend() {
  // If served from the backend itself (recommended), use a relative URL —
  // works in any environment (localhost, deployed, file:// won't but
  // file:// can't fetch http anyway).
  // The text input lets the user override for non-default setups.
  const override = $('backend-url').value.trim();
  if (override) return override.replace(/\/$/, '');
  return '';   // empty = same origin
}

function md(raw) {
  // Escape HTML first, then apply markdown
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

// ── RENDER ─────────────────────────────────────────────────────────────────
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

// ── SEND ───────────────────────────────────────────────────────────────────
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

  } catch (e) {
    hideTyping();
    history.pop(); // remove the failed user message from history
    appendMsg('ai', `⚠️ ${e.message}`, true);
  } finally {
    $('btn-send').disabled = false;
    input.focus();
  }
}

// ── EVENTS ─────────────────────────────────────────────────────────────────

$('btn-send').addEventListener('click', send);

$('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// Auto-grow textarea
$('msg-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});

// Module switch
document.querySelectorAll('.module-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.module-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    module = btn.dataset.module;
    history = [];
    const meta = MODULE_META[module];
    $('chat-title').textContent    = meta.title;
    $('chat-subtitle').textContent = meta.subtitle;
    renderWelcome();
  });
});

// Clear conversation
$('btn-clear').addEventListener('click', () => {
  history = [];
  renderWelcome();
});

// ── BOOT ───────────────────────────────────────────────────────────────────
renderWelcome();

// ── AUDIO / TTS / STT ──────────────────────────────────────────────────────
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
