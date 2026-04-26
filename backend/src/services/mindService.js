const supabase = require('../config/supabase');
const { chat, parseJSON } = require('./aiService');

const SYSTEM_PROMPT = `You are a compassionate mental health support AI for IDF soldiers recovering from combat injuries.
Your role is to gently analyze their mood and guide them toward coping techniques.

Guidelines:
- Be warm, human, and non-clinical in tone
- Acknowledge the unique weight of military service and recovery
- Never make clinical diagnoses or prescribe medication
- Set crisis_flag to true ONLY if you detect severe distress, suicidal ideation, or immediate danger

Respond with ONLY valid JSON in this exact structure:
{
  "sentiment": "anxious|low|agitated|exhausted|stable",
  "response": "brief compassionate message (2-3 sentences max)",
  "recommendation": {
    "type": "breathing|grounding|journaling|relaxation",
    "title": "technique name",
    "instruction": "clear step-by-step instruction for the technique"
  },
  "crisis_flag": false
}`;

/**
 * Analyze a mood check-in, save to DB, return AI recommendation.
 */
async function analyzeMood(userId, textInput, language = 'he') {
  const langNote = language === 'he' ? 'Respond in Hebrew.' : 'Respond in English.';

  const rawResponse = await chat(
    [
      { role: 'system', content: `${SYSTEM_PROMPT}\n${langNote}` },
      { role: 'user', content: textInput },
    ],
    { priority: 1, maxTokens: 512, temperature: 0.6 }
  );

  let parsed;
  try {
    parsed = parseJSON(rawResponse);
  } catch {
    parsed = {
      sentiment: 'stable',
      response: language === 'he' ? 'תודה ששיתפת. אני כאן בשבילך.' : 'Thank you for sharing. I am here for you.',
      recommendation: {
        type: 'breathing',
        title: language === 'he' ? 'נשימה מרגיעה' : 'Calming Breath',
        instruction: language === 'he'
          ? 'שאף אוויר ל-4 שניות, החזק ל-4, שחרר ל-4. חזור 4 פעמים.'
          : 'Inhale for 4 seconds, hold for 4, exhale for 4. Repeat 4 times.',
      },
      crisis_flag: false,
    };
  }

  // Persist to Supabase
  const { data, error } = await supabase
    .from('mood_logs')
    .insert({
      user_id: userId,
      text_input: textInput,
      sentiment: parsed.sentiment,
      ai_recommendation: parsed,
    })
    .select()
    .single();

  if (error) throw error;

  // If crisis flag set, log a separate alert (can be extended to notify a counselor)
  if (parsed.crisis_flag) {
    console.warn(`[CRISIS FLAG] User ${userId} — mood log ${data.id}`);
    await supabase.from('crisis_alerts').insert({ user_id: userId, mood_log_id: data.id });
  }

  return data;
}

/**
 * Return the latest mood log for a user.
 */
async function getLatestMood(userId) {
  const { data, error } = await supabase
    .from('mood_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || null;
}

/**
 * Return paginated mood history.
 */
async function getMoodHistory(userId, { page = 1, limit = 14 } = {}) {
  const from = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from('mood_logs')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw error;
  return { logs: data, total: count, page, limit };
}

/**
 * Build today's coping toolkit based on latest mood.
 */
async function getCopingToolkit(userId) {
  const latest = await getLatestMood(userId);

  const sentiment = latest?.sentiment || 'stable';
  const cacheKey = `coping:${userId}:${sentiment}`;

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are a coping toolkit AI for injured IDF soldiers.
Given a soldier's current emotional state, return a curated toolkit of 3 activities.
Respond with ONLY valid JSON:
{
  "activities": [
    {
      "type": "breathing|grounding|journaling|relaxation|movement",
      "title": "activity name",
      "duration_min": 5,
      "description": "what it is and why it helps",
      "steps": ["step 1", "step 2", "step 3"]
    }
  ]
}`,
      },
      { role: 'user', content: `Current state: ${sentiment}. Today's date context: ${new Date().toDateString()}.` },
    ],
    { priority: 2, cacheKey, cacheTtlMs: 4 * 60 * 60 * 1000, maxTokens: 768 }
  );

  try {
    return parseJSON(rawResponse);
  } catch {
    return { activities: [] };
  }
}

/**
 * Mark a coping session as completed.
 */
async function completeCopingSession(userId, type) {
  const { data, error } = await supabase
    .from('coping_sessions')
    .insert({ user_id: userId, type, completed: true })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { analyzeMood, getLatestMood, getMoodHistory, getCopingToolkit, completeCopingSession };
