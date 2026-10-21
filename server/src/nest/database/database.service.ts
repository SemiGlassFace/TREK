import { Inject, Injectable } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { canAccessTrip, getPlaceWithTags, isOwner } from '../../db/database';
import type { PlaceWithTags, TripAccess } from '../../db/database';
import { DATABASE_CONNECTION } from './database.tokens';

export type { PlaceWithTags, TripAccess };

/**
 * Injectable wrapper around TREK's existing better-sqlite3 connection.
 *
 * The injected connection is the Proxy onto the singleton the legacy app
 * already uses (WAL enabled), so Nest modules share the exact same
 * connection — no second connection, no split state, single writer preserved.
 */
@Injectable()
export class DatabaseService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: Database.Database) {}

  /** The shared better-sqlite3 connection (same singleton the legacy app uses). */
  get connection(): Database.Database {
    return this.conn;
  }

  prepare(sql: string): Database.Statement {
    return this.conn.prepare(sql);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.conn.prepare(sql).get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.conn.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.conn.prepare(sql).run(...params);
  }

  /** Run `fn` inside a synchronous better-sqlite3 transaction. */
  transaction<T>(fn: (conn: Database.Database) => T): T {
    return this.conn.transaction(() => fn(this.conn))();
  }

  // Trip-access helpers delegate to the db/database exports (not this.conn):
  // tests vi.mock that module and stub the helpers themselves, so the stubs
  // must keep flowing through here.

  /** Trip visible to the user (owner or member); undefined when no access. */
  canAccessTrip(tripId: number | string, userId: number): TripAccess | undefined {
    return canAccessTrip(tripId, userId);
  }

  /**
   * Read-only access to a trip its owner made public.
   *
   * Deliberately NOT folded into canAccessTrip: that predicate is called from ~130
   * places (writes, files, MCP, plugin RPC, realtime) and every one of them would
   * start treating any logged-in user as a member. Only TripAccessGuard and
   * TripPublicController ask this, and the guard only for handlers that opted in
   * with @ViewerReadable(). Runs on the connection, like rosterUserIds, so it does
   * not depend on a db/database export the test mocks would each have to repeat.
   */
  canViewPublicTrip(tripId: number | string): TripAccess | undefined {
    // Two lookups rather than a join: on the common path (a private trip a stranger
    // asked for) only the one-column flag table is touched.
    if (!this.get('SELECT 1 FROM trip_public_visibility WHERE trip_id = ?', tripId)) return undefined;
    const row = this.get<TripAccess>('SELECT id, user_id, currency FROM trips WHERE id = ?', tripId);
    return row ? { ...row, is_viewer: true } : undefined;
  }

  isOwner(tripId: number | string, userId: number): boolean {
    return isOwner(tripId, userId);
  }

  /**
   * The user ids a trip may refer to: its members plus the owner. Guests count —
   * a guest is a credential-less users row joined into trip_members, and #1362
   * makes it assignable everywhere a real member is.
   *
   * This is canAccessTrip's question asked as a set rather than a predicate, so
   * it lives beside it. Domains that accept user ids in a write body intersect
   * against it: holding the permission says you may edit the trip, not that any
   * id you name belongs to it. Runs on the connection rather than delegating to
   * db/database, because it has no legacy export to stay parity with.
   */
  rosterUserIds(tripId: number | string): Set<number> {
    const rows = this.all<{ user_id: number }>(
      'SELECT user_id FROM trip_members WHERE trip_id = ? UNION SELECT user_id FROM trips WHERE id = ?',
      tripId, tripId,
    );
    return new Set(rows.map(r => r.user_id));
  }

  getPlaceWithTags(placeId: number | string): PlaceWithTags | null {
    return getPlaceWithTags(placeId);
  }
}
