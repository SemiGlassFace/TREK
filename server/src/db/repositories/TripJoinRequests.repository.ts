import type { TripJoinRequests } from '../entities/TripJoinRequests.entity';
import type { DB } from '../kysely/db';
import { dbNow } from '../types';
import { TrekRepository } from './_shared/trek-repository';

/** A pending request as the owner sees it. */
export interface PendingJoinRequestRow {
  id: number;
  trip_id: number;
  user_id: number;
  status: string;
  created_at: string | null;
  username: string;
}

/**
 * One row per trip and requester, so a rejected request is re-opened by updating its
 * row instead of adding another.
 */
export class TripJoinRequestsRepository extends TrekRepository<TripJoinRequests> {
  /** The trip's owner and title, or undefined when it is gone. */
  async findTripOwnerAndTitle(trip_id: number): Promise<{ user_id: number; title: string } | undefined> {
    return await this.kysely<Pick<DB, 'trips'>>()
      .selectFrom('trips')
      .select(['user_id', 'title'])
      .where('id', '=', trip_id)
      .executeTakeFirst();
  }

  /** What the owner sees of a requester: their display name, else their username. */
  async findRequesterName(user_id: number): Promise<string | undefined> {
    const row = await this.kysely<Pick<DB, 'users'>>()
      .selectFrom('users')
      .select((eb) => eb.fn.coalesce('display_name', 'username').as('name'))
      .where('id', '=', user_id)
      .executeTakeFirst();
    return row ? String(row.name) : undefined;
  }

  /** The caller's own request on a trip, whatever its state, or null. */
  async statusFor(trip_id: number, user_id: number): Promise<string | null> {
    const row = await this.findOne({ trip: trip_id, user: user_id });
    return row?.status ?? null;
  }

  async listPending(trip_id: number): Promise<PendingJoinRequestRow[]> {
    const rows = await this.kysely<Pick<DB, 'trip_join_requests' | 'users'>>()
      .selectFrom('trip_join_requests as jr')
      .innerJoin('users as u', 'u.id', 'jr.user_id')
      .select((eb) => [
        'jr.id',
        'jr.trip_id',
        'jr.user_id',
        'jr.status',
        'jr.created_at',
        eb.fn.coalesce('u.display_name', 'u.username').as('username'),
      ])
      .where('jr.trip_id', '=', trip_id)
      .where('jr.status', '=', 'pending')
      .orderBy('jr.created_at', 'asc')
      .execute();
    return rows.map((r) => ({ ...r, created_at: r.created_at ?? null, username: String(r.username) }));
  }

  /** The requester of a request that is still waiting on this trip, or undefined. */
  async findPendingRequester(trip_id: number, request_id: number): Promise<number | undefined> {
    const row = await this.findOne({ id: request_id, trip: trip_id, status: 'pending' });
    return row?.user_id;
  }

  /** (Re-)opens the request: a new row, or the existing one with its decision cleared. */
  async open(trip_id: number, user_id: number): Promise<void> {
    await this.upsert(
      { trip: trip_id, user: user_id, status: 'pending', created_at: dbNow(), resolved_at: null },
      {
        onConflictFields: ['trip', 'user'],
        onConflictAction: 'merge',
        onConflictMergeFields: ['status', 'created_at', 'resolved_at'],
      },
    );
  }

  async decide(trip_id: number, user_id: number, status: 'accepted' | 'rejected'): Promise<void> {
    await this.nativeUpdate({ trip: trip_id, user: user_id }, { status, resolved_at: dbNow() });
  }

  /** Withdraws a waiting request. True when there was one. */
  async cancelPending(trip_id: number, user_id: number): Promise<boolean> {
    return (await this.nativeDelete({ trip: trip_id, user: user_id, status: 'pending' })) > 0;
  }

  /** Nobody can act on a request for a trip that is no longer discoverable. */
  async dropPending(trip_id: number): Promise<void> {
    await this.nativeDelete({ trip: trip_id, status: 'pending' });
  }
}
