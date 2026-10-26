import type { TripPublicVisibility } from '../entities/TripPublicVisibility.entity';
import { Trips } from '../entities/Trips.entity';
import type { DB } from '../kysely/db';
import type { TripAccess, TripSelectRow, TripsRepository } from './Trips.repository';
import { TrekRepository } from './_shared/trek-repository';
import { tripAccessExpr } from './_shared/trip-access';

import type { SelectQueryBuilder } from 'kysely';

/** `TripAccess` as the guard hands it over: `is_viewer` is set for a signed-in non-member of a public trip. */
export interface ViewerTripAccess extends TripAccess {
  is_viewer?: boolean;
}

/**
 * `TripsRepository.tripSelectQuery` knows five tables; the public view also reads the
 * publish flag and the caller's join request. The builder is the same statement, so the
 * widening is a type-level statement only.
 */
type TripSelectBase = ReturnType<TripsRepository['tripSelectQuery']>;
type TripSelectOutput = TripSelectBase extends SelectQueryBuilder<infer _DB, infer _TB, infer O> ? O : never;
type PublicTripDB = Pick<
  DB,
  'trips' | 'users' | 'trip_members' | 'days' | 'places' | 'trip_public_visibility' | 'trip_join_requests'
> & { t: DB['trips']; u: DB['users'] };

/** Fork: a list/detail row that may belong to somebody else's public trip. */
export interface PublicTripSelectRow extends TripSelectRow {
  /** 1 for a signed-in non-member reading a public trip, else 0. */
  is_viewer: number;
  is_public: number;
  /** The caller's own request on this trip; an accepted one reads as none. */
  join_request_status: string | null;
}

/**
 * The owner's "this trip is public" flag: one row per published trip, none for a
 * private one. Read-only visitors are admitted on the strength of this row alone,
 * so it is deliberately a table of its own and not a column `trips` queries
 * could pick up by accident.
 */
export class TripPublicVisibilityRepository extends TrekRepository<TripPublicVisibility> {
  async isPublic(trip_id: number): Promise<boolean> {
    return (await this.count({ trip: trip_id })) > 0;
  }

  /**
   * The access row of a published trip, flagged as a visitor's, or undefined when the
   * trip is private or gone. Two lookups rather than a join: on the common path (a
   * private trip a stranger asked for) only the one-column flag table is touched.
   */
  async findPublicTrip(trip_id: number): Promise<ViewerTripAccess | undefined> {
    if (!(await this.isPublic(trip_id))) return undefined;
    const row = await this.kysely<Pick<DB, 'trips'>>()
      .selectFrom('trips')
      .select(['id', 'user_id', 'currency'])
      .where('id', '=', trip_id)
      .executeTakeFirst();
    return row ? { id: row.id, user_id: row.user_id, currency: row.currency ?? null, is_viewer: true } : undefined;
  }

  /**
   * `TripsRepository.tripSelectQuery` widened to the trips the caller reached because
   * their owner published them, with the viewer flags computed in the same statement so
   * `feed_token` stays the outermost `NULL` it has to be. Separate from `listForUser` and
   * `findForViewer` on purpose: the MCP tools and the plugin RPC reach those, and "which
   * trips can this principal reach" must stay members-only there.
   */
  private publicTripSelectQuery(user_id: number) {
    const base = this.getEntityManager().getRepository(Trips).tripSelectQuery(user_id);
    return (base as unknown as SelectQueryBuilder<PublicTripDB, 't' | 'u', TripSelectOutput>)
      .leftJoin('trip_members as m', (join) => join.onRef('m.trip_id', '=', 't.id').on('m.user_id', '=', user_id))
      .leftJoin('trip_public_visibility as pv', 'pv.trip_id', 't.id')
      .leftJoin('trip_join_requests as jr', (join) =>
        join.onRef('jr.trip_id', '=', 't.id').on('jr.user_id', '=', user_id).on('jr.status', '!=', 'accepted'),
      )
      .select((eb) => [
        eb
          .case()
          .when(tripAccessExpr(eb, 't.user_id', 'm.user_id', user_id))
          .then(0)
          .else(1)
          .end()
          .as('is_viewer'),
        eb.case().when('pv.trip_id', 'is not', null).then(1).else(0).end().as('is_public'),
        'jr.status as join_request_status',
      ])
      .where((eb) => eb.or([tripAccessExpr(eb, 't.user_id', 'm.user_id', user_id), eb('pv.trip_id', 'is not', null)]));
  }

  async listTrips(user_id: number, archived: number | null): Promise<PublicTripSelectRow[]> {
    let query = this.publicTripSelectQuery(user_id);
    if (archived !== null) query = query.where('t.is_archived', '=', archived);
    return (await query.orderBy('t.created_at', 'desc').execute()) as PublicTripSelectRow[];
  }

  async findTrip(trip_id: number | string, user_id: number): Promise<PublicTripSelectRow | undefined> {
    const row = await this.publicTripSelectQuery(user_id)
      .where('t.id', '=', trip_id as number)
      .executeTakeFirst();
    return row as PublicTripSelectRow | undefined;
  }

  async publish(trip_id: number, user_id: number): Promise<void> {
    await this.upsert(
      { trip: trip_id, enabledByRef: user_id },
      { onConflictFields: ['trip'], onConflictAction: 'ignore' },
    );
  }

  async unpublish(trip_id: number): Promise<void> {
    await this.nativeDelete({ trip: trip_id });
  }
}
