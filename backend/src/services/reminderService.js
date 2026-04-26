const supabase = require('../config/supabase');
const webpush = require('web-push');

// ---------------------------------------------------------------------------
// Push Subscription Management
// ---------------------------------------------------------------------------

/**
 * Register (or update) a browser push subscription for a user.
 * The `subscription` object comes directly from the browser's PushManager.subscribe().
 */
async function registerPushSubscription(userId, subscription) {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: userId, subscription, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Send a push notification to a user.
 * Silently removes the subscription if it is expired/invalid.
 */
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[PUSH] VAPID keys not configured — skipping notification');
    return;
  }

  // Configure lazily so the server starts without VAPID keys in dev
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@eitan-app.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const { data: row } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', userId)
    .single();

  if (!row) return; // No subscription registered

  try {
    await webpush.sendNotification(row.subscription, JSON.stringify(payload));
  } catch (err) {
    // 410 Gone = subscription expired; clean it up
    if (err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    } else {
      console.error(`[PUSH] Failed for user ${userId}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD for Reminders
// ---------------------------------------------------------------------------

const VALID_TYPES = ['prescription', 'appointment', 'break', 'exercise', 'hydration', 'therapy', 'custom'];
const VALID_RECURRENCE = ['once', 'daily', 'weekly', 'weekdays'];

async function createReminder(userId, data) {
  const {
    title,
    type = 'custom',
    description,
    scheduled_at,       // ISO string — for 'once' reminders
    recurrence = 'once',
    recurrence_time,    // 'HH:MM' — for recurring reminders
    recurrence_days,    // [0-6] — for 'weekly' reminders (0=Sun)
  } = data;

  const { data: reminder, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      title,
      type,
      description,
      scheduled_at: scheduled_at || null,
      recurrence,
      recurrence_time: recurrence_time || null,
      recurrence_days: recurrence_days || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return reminder;
}

async function getReminders(userId, { activeOnly = true } = {}) {
  let query = supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function updateReminder(userId, reminderId, updates) {
  const { data, error } = await supabase
    .from('reminders')
    .update(updates)
    .eq('id', reminderId)
    .eq('user_id', userId) // Ensures ownership
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteReminder(userId, reminderId) {
  const { error } = await supabase
    .from('reminders')
    .delete()
    .eq('id', reminderId)
    .eq('user_id', userId);

  if (error) throw error;
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Scheduler Logic — called by the cron job every minute
// ---------------------------------------------------------------------------

/**
 * Check all active reminders and fire any that are due right now.
 */
async function processDueReminders() {
  const now = new Date();
  const currentHHMM = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const currentDay = now.getUTCDay(); // 0 = Sunday

  // Fetch all active reminders
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('[SCHEDULER] Error fetching reminders:', error.message);
    return;
  }

  for (const reminder of reminders) {
    let shouldFire = false;

    if (reminder.recurrence === 'once') {
      if (!reminder.scheduled_at) continue;
      const target = new Date(reminder.scheduled_at);
      // Fire if within the current minute window
      const diffMs = Math.abs(now - target);
      shouldFire = diffMs < 60_000 && !reminder.last_sent_at;

    } else if (reminder.recurrence === 'daily') {
      shouldFire = reminder.recurrence_time === currentHHMM;

    } else if (reminder.recurrence === 'weekdays') {
      // Mon–Fri = days 1–5
      shouldFire = currentDay >= 1 && currentDay <= 5 && reminder.recurrence_time === currentHHMM;

    } else if (reminder.recurrence === 'weekly') {
      const days = reminder.recurrence_days || [];
      shouldFire = days.includes(currentDay) && reminder.recurrence_time === currentHHMM;
    }

    if (!shouldFire) continue;

    // Send the push notification
    await sendPushToUser(reminder.user_id, {
      title: `⏰ ${reminder.title}`,
      body: reminder.description || typeToDefaultMessage(reminder.type),
      icon: '/icon-192.png',
      tag: reminder.id,
      data: { reminderId: reminder.id, type: reminder.type },
    });

    // Update last_sent_at; deactivate 'once' reminders after firing
    await supabase
      .from('reminders')
      .update({
        last_sent_at: now.toISOString(),
        is_active: reminder.recurrence !== 'once',
      })
      .eq('id', reminder.id);

    console.log(`[SCHEDULER] Fired reminder "${reminder.title}" for user ${reminder.user_id}`);
  }
}

function typeToDefaultMessage(type) {
  const messages = {
    prescription: 'Time to take your medication 💊',
    appointment:  'You have an upcoming appointment 📅',
    break:        'Time to take a break and rest 🛌',
    exercise:     'Time for your rehabilitation exercises 💪',
    hydration:    'Remember to drink water 💧',
    therapy:      'Your therapy session is coming up 🧠',
    custom:       'You have a reminder set for this time.',
  };
  return messages[type] || messages.custom;
}

module.exports = {
  registerPushSubscription,
  sendPushToUser,
  createReminder,
  getReminders,
  updateReminder,
  deleteReminder,
  processDueReminders,
};
