const supabase = require('../config/supabase');
const { chat, parseJSON } = require('./aiService');

// ---------------------------------------------------------------------------
// Pain Logging
// ---------------------------------------------------------------------------
async function logPain(userId, { painLevel, location, notes }) {
  const { data, error } = await supabase
    .from('pain_logs')
    .insert({ user_id: userId, pain_level: painLevel, location, notes })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getPainHistory(userId, days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('pain_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', since)
    .order('logged_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Wearable Data
// ---------------------------------------------------------------------------
async function logWearableSnapshot(userId, snapshot) {
  const { data, error } = await supabase
    .from('wearable_snapshots')
    .insert({ user_id: userId, ...snapshot })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getLatestWearable(userId) {
  const { data, error } = await supabase
    .from('wearable_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ---------------------------------------------------------------------------
// Workout Plan Generation
// ---------------------------------------------------------------------------
async function generateWorkoutPlan(userId) {
  // Gather context
  const [profileRes, latestPainRes, wearableRes] = await Promise.all([
    supabase.from('profiles').select('injury_type, mobility_level').eq('id', userId).single(),
    supabase.from('pain_logs').select('*').eq('user_id', userId).order('logged_at', { ascending: false }).limit(1).single(),
    supabase.from('wearable_snapshots').select('*').eq('user_id', userId).order('recorded_at', { ascending: false }).limit(1).single(),
  ]);

  const profile = profileRes.data || {};
  const pain = latestPainRes.data || {};
  const wearable = wearableRes.data || {};

  const context = `
Soldier profile:
- Injury type: ${profile.injury_type || 'unspecified'}
- Mobility level: ${profile.mobility_level || 3}/5
- Latest pain level: ${pain.pain_level || 'unknown'}/10 (location: ${pain.location || 'unspecified'})
- Last night's sleep: ${wearable.sleep_hours || 'unknown'} hours, quality: ${wearable.sleep_quality || 'unknown'}
- Resting HR: ${wearable.resting_hr || 'unknown'} bpm
- HRV: ${wearable.hrv || 'unknown'}
  `.trim();

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are a physical rehabilitation AI for injured IDF soldiers.
Generate a SAFE daily workout plan based on the soldier's profile. ALWAYS prioritize safety — when in doubt, go lighter.
Respond with ONLY valid JSON:
{
  "exercises": [
    {
      "name": "exercise name",
      "category": "strength|mobility|cardio|balance|recovery",
      "sets": 3,
      "reps": 10,
      "duration_sec": 60,
      "rest_sec": 30,
      "instructions": "clear step-by-step instructions",
      "modifications": "easier alternative if needed",
      "avoid_if": "condition that contraindicates this exercise"
    }
  ],
  "notes": "general guidance for today",
  "estimated_duration_min": 30,
  "intensity": "low|medium|high"
}`,
      },
      { role: 'user', content: context },
    ],
    { priority: 2, maxTokens: 1024, temperature: 0.5 }
  );

  let plan;
  try {
    plan = parseJSON(rawResponse);
  } catch {
    plan = { exercises: [], notes: 'Rest day recommended.', estimated_duration_min: 0, intensity: 'low' };
  }

  const today = new Date().toISOString().split('T')[0];

  // Upsert today's plan (one plan per user per day)
  const { data, error } = await supabase
    .from('workout_plans')
    .upsert(
      {
        user_id: userId,
        plan,
        generated_for: today,
        pain_level_at_generation: pain.pain_level || null,
        ai_notes: plan.notes,
      },
      { onConflict: 'user_id,generated_for' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getTodayWorkout(userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('workout_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('generated_for', today)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  // Auto-generate if none exists for today
  if (!data) return generateWorkoutPlan(userId);
  return data;
}

async function logWorkoutCompletion(userId, planId, { painAfter, energyAfter, notes }) {
  const { data, error } = await supabase
    .from('workout_logs')
    .insert({ user_id: userId, plan_id: planId, pain_after: painAfter, energy_after: energyAfter, notes })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// PT Report Generation
// ---------------------------------------------------------------------------
async function generatePTReport(userId, ptUserId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [painLogs, workoutLogs, wearableData, moodLogs] = await Promise.all([
    supabase.from('pain_logs').select('*').eq('user_id', userId).gte('logged_at', thirtyDaysAgo),
    supabase.from('workout_logs').select('*').eq('user_id', userId).gte('created_at', thirtyDaysAgo),
    supabase.from('wearable_snapshots').select('*').eq('user_id', userId).gte('recorded_at', thirtyDaysAgo),
    supabase.from('mood_logs').select('sentiment, created_at').eq('user_id', userId).gte('created_at', thirtyDaysAgo),
  ]);

  const reportInput = JSON.stringify({
    period: '30 days',
    pain_logs: painLogs.data || [],
    workout_completions: workoutLogs.data?.length || 0,
    sleep_avg_hours: wearableData.data?.length
      ? (wearableData.data.reduce((s, w) => s + (w.sleep_hours || 0), 0) / wearableData.data.length).toFixed(1)
      : null,
    mood_distribution: moodLogs.data?.reduce((acc, m) => {
      acc[m.sentiment] = (acc[m.sentiment] || 0) + 1;
      return acc;
    }, {}),
  });

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are a clinical report AI generating physical therapy progress reports for IDF soldiers.
Based on the provided 30-day data, generate a professional PT progress report.
Respond with ONLY valid JSON:
{
  "summary": "executive summary paragraph",
  "pain_trend": "improving|stable|worsening",
  "workout_adherence_pct": 85,
  "key_findings": ["finding 1", "finding 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "flags": ["anything requiring immediate PT attention"]
}`,
      },
      { role: 'user', content: reportInput },
    ],
    { priority: 2, maxTokens: 1024, temperature: 0.4 }
  );

  let reportData;
  try {
    reportData = parseJSON(rawResponse);
  } catch {
    reportData = { summary: 'Unable to generate report at this time.', flags: [] };
  }

  const periodStart = new Date(thirtyDaysAgo).toISOString().split('T')[0];
  const periodEnd = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('pt_reports')
    .insert({
      user_id: userId,
      pt_user_id: ptUserId,
      report_data: reportData,
      summary: reportData.summary,
      period_start: periodStart,
      period_end: periodEnd,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  logPain,
  getPainHistory,
  logWearableSnapshot,
  getLatestWearable,
  generateWorkoutPlan,
  getTodayWorkout,
  logWorkoutCompletion,
  generatePTReport,
};
