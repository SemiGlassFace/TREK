type ActionHandler = (payload: Record<string, unknown>, respondingUserId: number) => Promise<void>;

const actionRegistry = new Map<string, ActionHandler>();

function registerAction(actionType: string, handler: ActionHandler): void {
  actionRegistry.set(actionType, handler);
}

function getAction(actionType: string): ActionHandler | undefined {
  return actionRegistry.get(actionType);
}

// Dev/test actions
registerAction('test_approve', async () => {
  console.log('[notifications] Test approve action executed');
});

registerAction('test_deny', async () => {
  console.log('[notifications] Test deny action executed');
});

// Join request actions
registerAction('join_request_accept', async (payload, respondingUserId) => {
  const tripId = payload.tripId as number;
  const userId = payload.userId as number;
  if (!tripId || !userId) return;
  const { db } = require('../db/database');
  const trip = db.prepare('SELECT user_id, title FROM trips WHERE id = ?').get(tripId) as { user_id: number; title: string } | undefined;
  if (!trip || trip.user_id !== respondingUserId) return;
  db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id) VALUES (?, ?)').run(tripId, userId);
  db.prepare('UPDATE trip_join_requests SET status = \'accepted\', resolved_at = CURRENT_TIMESTAMP WHERE trip_id = ? AND user_id = ?').run(tripId, userId);
  const { send } = require('./notificationService');
  send({
    event: 'trip_join_accepted',
    actorId: respondingUserId,
    scope: 'user',
    targetId: userId,
    params: { tripId: String(tripId), userId: String(userId), trip: trip.title || 'Untitled' },
  }).catch(() => {});
});

registerAction('join_request_reject', async (payload, respondingUserId) => {
  const tripId = payload.tripId as number;
  const userId = payload.userId as number;
  if (!tripId || !userId) return;
  const { db } = require('../db/database');
  const trip = db.prepare('SELECT user_id, title FROM trips WHERE id = ?').get(tripId) as { user_id: number; title: string } | undefined;
  if (!trip || trip.user_id !== respondingUserId) return;
  db.prepare('UPDATE trip_join_requests SET status = \'rejected\', resolved_at = CURRENT_TIMESTAMP WHERE trip_id = ? AND user_id = ?').run(tripId, userId);
  const { send } = require('./notificationService');
  send({
    event: 'trip_join_rejected',
    actorId: respondingUserId,
    scope: 'user',
    targetId: userId,
    params: { tripId: String(tripId), trip: trip.title || 'Untitled' },
  }).catch(() => {});
});

export { registerAction, getAction };
