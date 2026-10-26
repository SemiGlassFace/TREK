import { rewindForkSchemaVersion } from '../../../src/db/fork-legacy-fixup';
import type { Connection } from '@mikro-orm/core';

import { describe, it, expect } from 'vitest';

interface Install {
  version: number;
  tables: string[];
  migrated?: boolean;
}

/** The slice of the ORM connection the fix-up uses, over a description of an install. */
function connectionOver(install: Install): Connection {
  return {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('sqlite_master')) return install.tables.includes(String(params[0])) ? [{ name: params[0] }] : [];
      if (sql.includes('COUNT(*)')) return [{ n: install.migrated ? 1 : 0 }];
      if (sql.startsWith('UPDATE')) install.version = Number(params[0]);
      return [{ version: install.version }];
    },
  } as unknown as Connection;
}

const FORK = ['schema_version', 'trip_join_requests'];

describe('rewindForkSchemaVersion', () => {
  it('FORKFIX-001: the 4.3.3 build of the fork reads as upstream 244, the 3.4 one as 175', async () => {
    const a: Install = { version: 246, tables: FORK };
    const b: Install = { version: 177, tables: FORK };
    await Promise.all([a, b].map((install) => rewindForkSchemaVersion(connectionOver(install))));
    expect([a.version, b.version]).toEqual([244, 175]);
  });

  it('FORKFIX-002: it is done after the first time, and any other version is left alone', async () => {
    const first: Install = { version: 246, tables: FORK };
    await rewindForkSchemaVersion(connectionOver(first));
    await rewindForkSchemaVersion(connectionOver(first));
    expect(first.version).toBe(244);
    const others = [175, 244, 245, 258].map((version): Install => ({ version, tables: FORK }));
    await Promise.all(others.map((install) => rewindForkSchemaVersion(connectionOver(install))));
    expect(others.map((install) => install.version)).toEqual([175, 244, 245, 258]);
  });

  it('FORKFIX-003: an install without the fork table, or one the migrator already owns, is never touched', async () => {
    const plain: Install = { version: 246, tables: ['schema_version'] };
    const migrated: Install = { version: 246, tables: [...FORK, 'mikro_orm_migrations'], migrated: true };
    await rewindForkSchemaVersion(connectionOver(plain));
    await rewindForkSchemaVersion(connectionOver(migrated));
    await rewindForkSchemaVersion(connectionOver({ version: 0, tables: [] }));
    expect([plain.version, migrated.version]).toEqual([246, 246]);
  });
});
