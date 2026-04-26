const supabase = require('../config/supabase');
const { chat, parseJSON } = require('./aiService');

// ---------------------------------------------------------------------------
// Peer Group Matching
// ---------------------------------------------------------------------------
async function matchPeerGroup(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('injury_type, interests, region')
    .eq('id', userId)
    .single();

  const { data: existingGroups } = await supabase
    .from('peer_groups')
    .select('id, topic, peer_group_members(count)');

  const openGroups = (existingGroups || []).filter(
    (g) => (g.peer_group_members?.[0]?.count || 0) < 6
  );

  const context = JSON.stringify({
    soldier_profile: profile,
    available_groups: openGroups.map((g) => ({ id: g.id, topic: g.topic })),
  });

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are a peer group matching AI for injured IDF soldiers.
Given a soldier's profile and available peer groups, decide whether to join an existing group or create a new one.
Respond with ONLY valid JSON:
{
  "action": "join|create",
  "group_id": "uuid-if-joining or null",
  "suggested_topic": "topic for new group if creating",
  "rationale": "brief explanation"
}`,
      },
      { role: 'user', content: context },
    ],
    { priority: 3, maxTokens: 256, temperature: 0.6 }
  );

  let decision;
  try {
    decision = parseJSON(rawResponse);
  } catch {
    decision = { action: 'create', suggested_topic: 'Recovery & Resilience' };
  }

  let groupId;
  if (decision.action === 'join' && decision.group_id) {
    groupId = decision.group_id;
  } else {
    const { data: newGroup, error } = await supabase
      .from('peer_groups')
      .insert({ topic: decision.suggested_topic || 'Recovery & Resilience' })
      .select()
      .single();
    if (error) throw error;
    groupId = newGroup.id;
  }

  const alias = `Warrior${Math.floor(1000 + Math.random() * 9000)}`;
  await supabase
    .from('peer_group_members')
    .upsert({ group_id: groupId, user_id: userId, anonymous_alias: alias }, { onConflict: 'group_id,user_id' });

  const { data: group } = await supabase
    .from('peer_groups')
    .select('*, peer_group_members(anonymous_alias, joined_at)')
    .eq('id', groupId)
    .single();

  return group;
}

async function getMyPeerGroup(userId) {
  const { data: membership } = await supabase
    .from('peer_group_members')
    .select('group_id, anonymous_alias')
    .eq('user_id', userId)
    .single();

  if (!membership) return null;

  const { data: group } = await supabase
    .from('peer_groups')
    .select('*, peer_group_members(anonymous_alias, joined_at)')
    .eq('id', membership.group_id)
    .single();

  return { ...group, my_alias: membership.anonymous_alias };
}

// ---------------------------------------------------------------------------
// Buddy / Mentor Matching
// ---------------------------------------------------------------------------
async function matchBuddy(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('injury_type, interests, region, career_goal')
    .eq('id', userId)
    .single();

  const { data: mentors } = await supabase
    .from('profiles')
    .select('id, injury_type, interests, region, career_goal')
    .eq('role', 'mentor')
    .limit(20);

  if (!mentors || mentors.length === 0) {
    return { message: 'No mentors available right now. You have been added to the waitlist.' };
  }

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are a mentor-matching AI for injured IDF soldiers.
Given a soldier's profile and available mentors, pick the best match.
Consider: shared interests, career alignment, geographic proximity, injury type familiarity.
Respond with ONLY valid JSON:
{
  "mentor_id": "uuid",
  "match_score": 0.87,
  "rationale": "explanation",
  "conversation_starter": "suggested first message"
}`,
      },
      { role: 'user', content: JSON.stringify({ soldier: profile, mentors }) },
    ],
    { priority: 3, maxTokens: 512, temperature: 0.5 }
  );

  let match;
  try {
    match = parseJSON(rawResponse);
  } catch {
    match = { mentor_id: mentors[0].id, match_score: 0.5, rationale: 'Auto-matched', conversation_starter: 'Hello!' };
  }

  const { data: buddyMatch, error } = await supabase
    .from('buddy_matches')
    .upsert(
      { soldier_id: userId, mentor_id: match.mentor_id, match_score: match.match_score, status: 'active' },
      { onConflict: 'soldier_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return { ...buddyMatch, rationale: match.rationale, conversation_starter: match.conversation_starter };
}

async function getMyBuddy(userId) {
  const { data, error } = await supabase
    .from('buddy_matches')
    .select('*, mentor:mentor_id(id, full_name, interests, career_goal, region)')
    .eq('soldier_id', userId)
    .eq('status', 'active')
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ---------------------------------------------------------------------------
// Activity Recommender
// ---------------------------------------------------------------------------
async function getActivities(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('mobility_level, region, interests')
    .eq('id', userId)
    .single();

  const cacheKey = `activities:${userId}:${new Date().toISOString().split('T')[0]}`;

  const rawResponse = await chat(
    [
      {
        role: 'system',
        content: `You are an activity recommendation AI for injured IDF soldiers.
Suggest 5 accessible, meaningful activities based on the soldier's profile.
Respond with ONLY valid JSON:
{
  "activities": [
    {
      "name": "activity name",
      "type": "adaptive_sport|art|social|outdoor|indoor|educational|volunteering",
      "description": "brief description",
      "physical_demand": "low|medium|high",
      "social": true,
      "search_query": "Google Maps search query",
      "why_recommended": "personalized reason"
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `Mobility level: ${profile?.mobility_level || 3}/5. Region: ${profile?.region || 'Israel'}. Interests: ${(profile?.interests || []).join(', ') || 'general'}.`,
      },
    ],
    { priority: 3, cacheKey, cacheTtlMs: 24 * 60 * 60 * 1000, maxTokens: 768, temperature: 0.7 }
  );

  try {
    return parseJSON(rawResponse);
  } catch {
    return { activities: [] };
  }
}

// ---------------------------------------------------------------------------
// Community Feed
// ---------------------------------------------------------------------------
async function getCommunityFeed() {
  const { data: mentors } = await supabase
    .from('profiles')
    .select('id, full_name, career_goal, region, interests')
    .eq('role', 'mentor')
    .limit(10);

  return { mentors: mentors || [], events: [] };
}

module.exports = { matchPeerGroup, getMyPeerGroup, matchBuddy, getMyBuddy, getActivities, getCommunityFeed };
