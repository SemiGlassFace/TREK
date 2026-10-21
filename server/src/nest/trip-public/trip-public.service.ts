import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { registerAction } from '../notifications/in-app-actions';
import { NotFoundError, ValidationError } from '../common/domain-errors';

export interface JoinRequest {
  id: number;
  trip_id: number;
  user_id: number;
  username: string;
  status: string;
  created_at: string;
}

type Resolution = 'accepted' | 'rejected';

/**
 * Public trips: the owner's publish flag and the join-request lifecycle.
 *
 * A request is `pending` until the owner decides, and can be resolved from two
 * places — the members dialog and the buttons on the in-app notification. Both
 * go through `resolve()` so the member row, the status and the message to the
 * requester cannot drift apart between them.
 *
 * Read-only access itself is not here: it lives in TripAccessGuard, behind
 * `@ViewerReadable()`, so that this module can be removed without leaving a hole.
 */
@Injectable()
export class TripPublicService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.dbs.connection;
  }

  onModuleInit(): void {
    // The registry is process-wide and keyed by action name, so registering again
    // (a second app instance in the test harness) just replaces the handler.
    registerAction('join_request_accept', async (payload, respondingUserId) => {
      this.resolveFromNotification(payload, respondingUserId, 'accepted');
    });
    registerAction('join_request_reject', async (payload, respondingUserId) => {
      this.resolveFromNotification(payload, respondingUserId, 'rejected');
    });
  }

  // ── Visibility ────────────────────────────────────────────────────────────

  isPublic(tripId: string | number): boolean {
    return !!this.db.prepare('SELECT 1 FROM trip_public_visibility WHERE trip_id = ?').get(tripId);
  }

  setPublic(tripId: string | number, isPublic: boolean, userId: number): void {
    if (isPublic) {
      this.db.prepare('INSERT OR IGNORE INTO trip_public_visibility (trip_id, enabled_by) VALUES (?, ?)').run(tripId, userId);
    } else {
      this.db.prepare('DELETE FROM trip_public_visibility WHERE trip_id = ?').run(tripId);
      // Nobody can act on a request for a trip that is no longer discoverable.
      this.db.prepare("DELETE FROM trip_join_requests WHERE trip_id = ? AND status = 'pending'").run(tripId);
    }
  }

  // ── Join requests ─────────────────────────────────────────────────────────

  private isMemberOrOwner(tripId: string | number, userId: number): boolean {
    return !!this.dbs.canAccessTrip(tripId, userId);
  }

  /** The caller's own request, as shown on the trip card. Null when there is none to act on. */
  statusFor(tripId: string | number, userId: number): string | null {
    const row = this.db.prepare('SELECT status FROM trip_join_requests WHERE trip_id = ? AND user_id = ?')
      .get(tripId, userId) as { status: string } | undefined;
    return row?.status ?? null;
  }

  listPending(tripId: string | number): JoinRequest[] {
    return this.db.prepare(`
      SELECT jr.id, jr.trip_id, jr.user_id, jr.status, jr.created_at,
        COALESCE(u.display_name, u.username) AS username
      FROM trip_join_requests jr
      JOIN users u ON u.id = jr.user_id
      WHERE jr.trip_id = ? AND jr.status = 'pending'
      ORDER BY jr.created_at ASC
    `).all(tripId) as JoinRequest[];
  }

  /** A visitor asks to join. Already pending is a no-op; a rejected request may be sent again. */
  submit(tripId: string | number, userId: number): 'created' | 'pending' {
    if (!this.isPublic(tripId)) throw new NotFoundError('Trip not found');
    if (this.isMemberOrOwner(tripId, userId)) throw new ValidationError('You are already a member of this trip');

    const existing = this.statusFor(tripId, userId);
    if (existing === 'pending') return 'pending';

    this.db.prepare(`
      INSERT INTO trip_join_requests (trip_id, user_id, status, created_at, resolved_at)
      VALUES (?, ?, 'pending', CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(trip_id, user_id) DO UPDATE SET status = 'pending', created_at = CURRENT_TIMESTAMP, resolved_at = NULL
    `).run(tripId, userId);
    this.notifyOwner(tripId, userId);
    return 'created';
  }

  cancel(tripId: string | number, userId: number): boolean {
    const result = this.db.prepare("DELETE FROM trip_join_requests WHERE trip_id = ? AND user_id = ? AND status = 'pending'")
      .run(tripId, userId);
    return result.changes > 0;
  }

  /** Owner decision from the members dialog. Returns the requester's user id. */
  resolveById(tripId: string | number, requestId: number, decision: Resolution): number {
    const req = this.db.prepare("SELECT user_id FROM trip_join_requests WHERE id = ? AND trip_id = ? AND status = 'pending'")
      .get(requestId, tripId) as { user_id: number } | undefined;
    if (!req) throw new NotFoundError('Join request not found or already resolved');
    return this.resolve(tripId, req.user_id, decision);
  }

  private resolveFromNotification(payload: Record<string, unknown>, respondingUserId: number, decision: Resolution): void {
    const tripId = Number(payload.tripId);
    const userId = Number(payload.userId);
    if (!tripId || !userId) return;
    const trip = this.db.prepare('SELECT user_id FROM trips WHERE id = ?').get(tripId) as { user_id: number } | undefined;
    // Only the owner decides, and only on a request that is still waiting: a stale
    // "accept" must not re-add someone the owner has since removed.
    if (!trip || trip.user_id !== respondingUserId) return;
    if (this.statusFor(tripId, userId) !== 'pending') return;
    this.resolve(tripId, userId, decision);
  }

  private resolve(tripId: string | number, userId: number, decision: Resolution): number {
    const ownerId = (this.db.prepare('SELECT user_id FROM trips WHERE id = ?').get(tripId) as { user_id: number }).user_id;
    this.dbs.transaction((db) => {
      if (decision === 'accepted') {
        db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)').run(tripId, userId, ownerId);
      }
      db.prepare('UPDATE trip_join_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE trip_id = ? AND user_id = ?')
        .run(decision, tripId, userId);
    });
    this.notifyRequester(tripId, userId, ownerId, decision);
    return userId;
  }

  // ── Notifications (fire-and-forget, like trip_invite) ─────────────────────

  private tripTitle(tripId: string | number): string {
    const row = this.db.prepare('SELECT title FROM trips WHERE id = ?').get(tripId) as { title: string } | undefined;
    return row?.title || 'Untitled';
  }

  private notifyOwner(tripId: string | number, requesterId: number): void {
    const trip = this.db.prepare('SELECT user_id FROM trips WHERE id = ?').get(tripId) as { user_id: number } | undefined;
    if (!trip) return;
    const requester = this.db.prepare('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = ?')
      .get(requesterId) as { name: string } | undefined;
    this.notifications.send({
      event: 'trip_join_request',
      actorId: requesterId,
      scope: 'user',
      targetId: trip.user_id,
      params: { tripId: String(tripId), userId: String(requesterId), trip: this.tripTitle(tripId), actor: requester?.name || 'Someone' },
      inApp: {
        type: 'boolean',
        positiveTextKey: 'notif.action.accept',
        negativeTextKey: 'notif.action.reject',
        positiveCallback: { action: 'join_request_accept', payload: { tripId: Number(tripId), userId: requesterId } },
        negativeCallback: { action: 'join_request_reject', payload: { tripId: Number(tripId), userId: requesterId } },
      },
    }).catch(() => {});
  }

  private notifyRequester(tripId: string | number, userId: number, ownerId: number, decision: Resolution): void {
    this.notifications.send({
      event: decision === 'accepted' ? 'trip_join_accepted' : 'trip_join_rejected',
      actorId: ownerId,
      scope: 'user',
      targetId: userId,
      params: { tripId: String(tripId), trip: this.tripTitle(tripId) },
    }).catch(() => {});
  }
}
