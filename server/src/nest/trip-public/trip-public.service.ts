import { TripJoinRequests } from '../../db/entities/TripJoinRequests.entity';
import type {
  PendingJoinRequestRow,
  TripJoinRequestsRepository,
} from '../../db/repositories/TripJoinRequests.repository';
import type { ViewerTripAccess } from '../../db/repositories/TripPublicVisibility.repository';
import { NotFoundError, ValidationError } from '../common/domain-errors';
import { UnitOfWork } from '../database/unit-of-work';
import { NotificationsService } from '../notifications/notifications.service';
import { PublicTripAccessService } from '../permissions/public-trip-access.service';
import { TripAccessService } from '../trip-membership/trip-access.service';
import { TripMembershipService } from '../trip-membership/trip-membership.service';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, OnModuleInit } from '@nestjs/common';

export type JoinRequest = PendingJoinRequestRow;

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
    private readonly visibility: PublicTripAccessService,
    @InjectRepository(TripJoinRequests) private readonly requests: TripJoinRequestsRepository,
    private readonly access: TripAccessService,
    private readonly membership: TripMembershipService,
    private readonly notifications: NotificationsService,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * @txIndependent each button answers one request on its own; the member row and the
   * decision are written together inside `resolve()`, which opens the transaction.
   */
  onModuleInit(): void {
    // The registry is process-wide and keyed by action name, so registering again
    // (a second app instance in the test harness) just replaces the handler.
    this.notifications.registerAction('join_request_accept', (payload, respondingUserId) =>
      this.resolveFromNotification(payload, respondingUserId, 'accepted'),
    );
    this.notifications.registerAction('join_request_reject', (payload, respondingUserId) =>
      this.resolveFromNotification(payload, respondingUserId, 'rejected'),
    );
  }

  // ── Visibility ────────────────────────────────────────────────────────────

  /** Owner, member, or visitor of a published trip; anyone else gets undefined. */
  async findVisible(tripId: number, userId: number): Promise<ViewerTripAccess | undefined> {
    return (await this.access.findAccessible(tripId, userId)) ?? (await this.visibility.findPublicTrip(tripId));
  }

  isPublic(tripId: number): Promise<boolean> {
    return this.visibility.isPublic(tripId);
  }

  async setPublic(tripId: number, isPublic: boolean, userId: number): Promise<void> {
    if (isPublic) {
      await this.visibility.publish(tripId, userId);
      return;
    }
    await this.uow.transactional(async () => {
      await this.visibility.unpublish(tripId);
      // Nobody can act on a request for a trip that is no longer discoverable.
      await this.requests.dropPending(tripId);
    });
  }

  // The dashboard / planner view of trips, including other people's public ones. Not
  // TripsService.list/get: the MCP tools and the plugin RPC call those, and "which trips
  // can this principal reach" must stay members-only there.

  /** Everything `TripsService.list` returns plus public trips of other owners, flagged `is_viewer`. */
  listTrips(userId: number, archived: number | null) {
    return this.visibility.listTrips(userId, archived);
  }

  /** `TripsService.get` that also opens a public trip of another owner, flagged `is_viewer`. */
  getTrip(tripId: string | number, userId: number) {
    return this.visibility.findTrip(tripId, userId);
  }

  // ── Join requests ─────────────────────────────────────────────────────────

  /** The caller's own request, as shown on the trip card. Null when there is none to act on. */
  statusFor(tripId: number, userId: number): Promise<string | null> {
    return this.requests.statusFor(tripId, userId);
  }

  listPending(tripId: number): Promise<JoinRequest[]> {
    return this.requests.listPending(tripId);
  }

  /** A visitor asks to join. Already pending is a no-op; a rejected request may be sent again. */
  async submit(tripId: number, userId: number): Promise<'created' | 'pending'> {
    if (!(await this.isPublic(tripId))) throw new NotFoundError('Trip not found');
    const trip = await this.requests.findTripOwnerAndTitle(tripId);
    if (!trip) throw new NotFoundError('Trip not found');
    if (await this.access.findAccessible(tripId, userId)) {
      throw new ValidationError('You are already a member of this trip');
    }
    if ((await this.statusFor(tripId, userId)) === 'pending') return 'pending';

    await this.requests.open(tripId, userId);
    void this.notifyOwner(tripId, trip.user_id, userId);
    return 'created';
  }

  cancel(tripId: number, userId: number): Promise<boolean> {
    return this.requests.cancelPending(tripId, userId);
  }

  /** Owner decision from the members dialog. Returns the requester's user id. */
  async resolveById(tripId: number, requestId: number, decision: Resolution): Promise<number> {
    const userId = await this.requests.findPendingRequester(tripId, requestId);
    if (userId === undefined) throw new NotFoundError('Join request not found or already resolved');
    await this.resolve(tripId, userId, decision);
    return userId;
  }

  private async resolveFromNotification(
    payload: Record<string, unknown>,
    respondingUserId: number,
    decision: Resolution,
  ): Promise<void> {
    const tripId = Number(payload.tripId);
    const userId = Number(payload.userId);
    if (!tripId || !userId) return;
    const trip = await this.requests.findTripOwnerAndTitle(tripId);
    // Only the owner decides, and only on a request that is still waiting: a stale
    // "accept" must not re-add someone the owner has since removed.
    if (!trip || trip.user_id !== respondingUserId) return;
    if ((await this.statusFor(tripId, userId)) !== 'pending') return;
    await this.resolve(tripId, userId, decision);
  }

  private async resolve(tripId: number, userId: number, decision: Resolution): Promise<void> {
    const trip = await this.requests.findTripOwnerAndTitle(tripId);
    if (!trip) throw new NotFoundError('Trip not found');
    await this.uow.transactional(async () => {
      // Added by the owner, by name in effect: this also lifts a removal note, like the
      // members dialog's "add by email" does.
      if (decision === 'accepted') await this.membership.joinTripAsMember(tripId, userId, trip.user_id);
      await this.requests.decide(tripId, userId, decision);
    });
    void this.notifyRequester(tripId, userId, trip.user_id, decision);
  }

  // ── Notifications (fire-and-forget, like trip_invite) ─────────────────────

  private async tripTitle(tripId: number): Promise<string> {
    return (await this.requests.findTripOwnerAndTitle(tripId))?.title || 'Untitled';
  }

  private async notifyOwner(tripId: number, ownerId: number, requesterId: number): Promise<void> {
    try {
      const requester = await this.requests.findRequesterName(requesterId);
      await this.notifications.send({
        event: 'trip_join_request',
        actorId: requesterId,
        scope: 'user',
        targetId: ownerId,
        params: {
          tripId: String(tripId),
          userId: String(requesterId),
          trip: await this.tripTitle(tripId),
          actor: requester || 'Someone',
        },
        inApp: {
          type: 'boolean',
          positiveTextKey: 'notif.action.accept',
          negativeTextKey: 'notif.action.reject',
          positiveCallback: { action: 'join_request_accept', payload: { tripId, userId: requesterId } },
          negativeCallback: { action: 'join_request_reject', payload: { tripId, userId: requesterId } },
        },
      });
    } catch {
      // A failed notification never fails the request that caused it.
    }
  }

  private async notifyRequester(tripId: number, userId: number, ownerId: number, decision: Resolution): Promise<void> {
    try {
      await this.notifications.send({
        event: decision === 'accepted' ? 'trip_join_accepted' : 'trip_join_rejected',
        actorId: ownerId,
        scope: 'user',
        targetId: userId,
        params: { tripId: String(tripId), trip: await this.tripTitle(tripId) },
      });
    } catch {
      // See notifyOwner.
    }
  }
}
