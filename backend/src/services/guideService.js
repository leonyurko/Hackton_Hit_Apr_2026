const supabase = require('../config/supabase');
const { chat, parseJSON } = require('./aiService');

const SYSTEM_PROMPT = `You are an expert benefits navigator for IDF soldiers and veterans in Israel.

Your knowledge covers:
- חוק הנכים (תגמולים ושיקום) - Disabled Veterans Law
- ביטוח לאומי (Bituach Leumi) disability benefits
- משרד הביטחון (Ministry of Defense) rehabilitation programs
- זכויות בריאות (healthcare rights) including mental health coverage
- תהליך ערעור (appeals process) for rejected claims

Guidelines:
- Always cite the relevant law or authority when possible
- Provide clear step-by-step action plans
- When uncertain, say so and direct to the relevant authority
- Respond in the SAME language the user writes in (Hebrew or English)
- Be empathetic — these soldiers have sacrificed greatly
- Do not make legal promises; recommend professional legal advice for complex cases`;

/**
 * Send a message to the benefits chatbot and get an AI reply.
 * Conversation history is persisted in Supabase.
 */
async function chat_(userId, userMessage) {
  // Load or initialize conversation
  let { data: convo } = await supabase
    .from('benefits_conversations')
    .select('*')
    .eq('user_id', userId)
    .single();

  const history = convo?.messages || [];

  // Append new user message
  history.push({ role: 'user', content: userMessage });

  // Build messages array: system + full history
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  const reply = await chat(messages, { priority: 1, maxTokens: 1024, temperature: 0.5 });

  // Append assistant reply to history
  history.push({ role: 'assistant', content: reply });

  // Keep last 30 messages to avoid token bloat
  const trimmed = history.slice(-30);

  // Upsert conversation
  await supabase
    .from('benefits_conversations')
    .upsert({ user_id: userId, messages: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  return { reply, history: trimmed };
}

async function getHistory(userId) {
  const { data, error } = await supabase
    .from('benefits_conversations')
    .select('messages, updated_at')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || { messages: [] };
}

async function clearHistory(userId) {
  await supabase
    .from('benefits_conversations')
    .upsert({ user_id: userId, messages: [], updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  return { cleared: true };
}

module.exports = { chat: chat_, getHistory, clearHistory };
