import { Migration } from '@mikro-orm/migrations';

/**
 * Fork feature: a trip can be published read-only, and a signed-in visitor can ask
 * to join it. See docs/fork-upgrade.md.
 *
 * `trip_public_visibility` holds one row per published trip (no row = private).
 * `trip_join_requests` keeps one row per trip and requester, so a rejected request
 * is re-opened by updating the row instead of adding another.
 *
 * Both tables are IF NOT EXISTS: a database the 4.3.x fork already ran has them,
 * and the data in them has to survive the move to 5.x. The timestamp sits far
 * above upstream's sequence so a future upstream migration never lands between.
 */
export class Migration20200101900100_public_trips_with_join_requests extends Migration {
  override name = 'Migration20200101900100_public_trips_with_join_requests';

  override up(): void {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS trip_public_visibility (
        trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
        enabled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        enabled_by INTEGER REFERENCES users(id)
      )
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS trip_join_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        UNIQUE(trip_id, user_id)
      )
    `);
    this.addSql('CREATE INDEX IF NOT EXISTS idx_trip_join_requests_trip ON trip_join_requests(trip_id)');
    this.addSql('CREATE INDEX IF NOT EXISTS idx_trip_join_requests_user ON trip_join_requests(user_id)');
    this.addSql(
      'CREATE INDEX IF NOT EXISTS idx_trip_public_visibility_enabled_by ON trip_public_visibility(enabled_by)',
    );
  }
}
