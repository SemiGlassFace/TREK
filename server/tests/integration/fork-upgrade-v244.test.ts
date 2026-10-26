/**
 * The fork's own upgrade path: an install that ran the 4.3.3 build of this fork
 * (public trips, join requests) sits at schema_version 246, which counts the fork's two
 * tables as steps. It is read as upstream's 244 (fork-legacy-fixup.ts) and boots on this release. The fork's two tables are not a
 * numbered step, so they are neither baselined nor replayed: their migration runs
 * (IF NOT EXISTS) and the rows survive. See docs/fork-upgrade.md.
 */
import { db as legacyDb } from '../../src/db/database';
import { TripJoinRequests } from '../../src/db/entities/TripJoinRequests.entity';
import { TripPublicVisibility } from '../../src/db/entities/TripPublicVisibility.entity';
import { findRows } from '../helpers/factories/rows';
import { describeLegacyUpgrade } from '../helpers/legacy-upgrade-suite';
import { createTestOrm } from '../helpers/test-orm';

import { it, expect, vi } from 'vitest';

vi.mock('../../src/db/database', async () => {
  const { buildDbMock } = await import('../helpers/db-mock');
  const { openLegacyFixture } = await import('../helpers/legacy-fixture');
  const db = openLegacyFixture('legacy-v244');
  // What the 4.3.3 build of the fork added on top of upstream's 244 steps.
  db.exec(`
    CREATE TABLE trip_public_visibility (
      trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
      enabled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      enabled_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE trip_join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      UNIQUE(trip_id, user_id)
    );
    CREATE INDEX idx_trip_join_requests_trip ON trip_join_requests(trip_id);
    INSERT INTO trip_public_visibility (trip_id, enabled_by) VALUES (1, 1);
    INSERT INTO trip_join_requests (trip_id, user_id, status) VALUES (1, 2, 'pending');
    UPDATE schema_version SET version = 246;
  `);
  return buildDbMock(db);
});

describeLegacyUpgrade(
  { fixture: 'legacy-v244', version: 244, reseated: 0, nightOrderIndex: 3, id: 'FORKUP-244' },
  legacyDb,
  () => {
    it('FORKUP-244-101: the version was read as upstream 244; the published trip and the pending request come through', async () => {
      const orm = await createTestOrm(legacyDb);
      try {
        expect(await findRows(orm, TripPublicVisibility, {})).toMatchObject([{ trip_id: 1, enabled_by: 1 }]);
        expect(await findRows(orm, TripJoinRequests, {})).toMatchObject([
          { trip_id: 1, user_id: 2, status: 'pending' },
        ]);
      } finally {
        await orm.close();
      }
    });
  },
);
