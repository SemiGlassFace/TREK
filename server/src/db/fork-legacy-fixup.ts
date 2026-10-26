import type { Connection } from '@mikro-orm/core';

/**
 * The fork's two tables used to be appended to upstream's positional migration list, so a
 * database the fork's earlier builds ran carries a `schema_version` that counts them:
 * 246 for the 4.3.3 build (upstream was at 244), 177 for the 3.4 one (upstream was at 175).
 * Upstream 5.x reads that number as "upstream steps 1..N are done", which would skip its own
 * steps of those numbers without a word. The fork's tables are an ordinary migration now,
 * so the version is put back to upstream's last step before the baseline reads it.
 *
 * Only a database still managed by the positional runner (no migrator rows yet) that has the
 * fork's table is touched, so plain upstream installs and anything already past the hand-over
 * are left alone. Runs on every bootstrap, a restored backup included, and does nothing after
 * the first. See docs/fork-upgrade.md.
 */
const UPSTREAM_STEP_BEFORE_FORK: ReadonlyMap<number, number> = new Map([
  [246, 244],
  [177, 175],
]);

async function tableExists(connection: Connection, name: string): Promise<boolean> {
  const rows: unknown[] = await connection.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [
    name,
  ]);
  return rows.length > 0;
}

export async function rewindForkSchemaVersion(connection: Connection): Promise<void> {
  if (!(await tableExists(connection, 'schema_version')) || !(await tableExists(connection, 'trip_join_requests'))) {
    return;
  }
  if (await tableExists(connection, 'mikro_orm_migrations')) {
    const done: Array<{ n: number }> = await connection.execute('SELECT COUNT(*) AS n FROM mikro_orm_migrations');
    if (done[0]?.n > 0) return;
  }
  const rows: Array<{ version: unknown }> = await connection.execute('SELECT version FROM schema_version');
  if (rows.length !== 1 || typeof rows[0].version !== 'number') return;
  const upstream = UPSTREAM_STEP_BEFORE_FORK.get(rows[0].version);
  if (upstream === undefined) return;
  await connection.execute('UPDATE schema_version SET version = ?', [upstream]);
}
