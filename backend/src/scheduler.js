const cron = require('node-cron');
const { processDueReminders } = require('./services/reminderService');

/**
 * Starts the reminder scheduler.
 * Runs every minute to check for due reminders and dispatch push notifications.
 */
function startScheduler() {
  console.log('⏱️  Reminder scheduler started (checks every minute)');

  // '* * * * *' = every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processDueReminders();
    } catch (err) {
      console.error('[SCHEDULER] Unhandled error:', err.message);
    }
  });
}

module.exports = { startScheduler };
