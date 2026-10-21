/**
 * Public trips: publishing a trip read-only, what a visitor can and cannot reach,
 * and the join-request lifecycle (PUBTRIP-xxx).
 *
 * Runs the real app on the real schema. The point of most cases is a negative: a
 * visitor is not a member, so the proof is that nothing outside the itinerary opens.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { INestApplication } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Bare in-memory DB — schema applied in beforeAll after mocks register
// ─────────────────────────────────────────────────────────────────────────────
const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`
        SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
        FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
      `).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };

  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
  SESSION_DURATION: '24h',
  SESSION_DURATION_MS: 86400000,
  SESSION_DURATION_SECONDS: 86400,
  DEFAULT_LANGUAGE: 'en',
}));
vi.mock('../../src/websocket', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn() }));

import { buildApp } from '../../src/bootstrap';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb, resetRateLimits } from '../helpers/test-db';
import { createUser, createTrip, addTripMember, createPlace, createReservation, createBudgetItem, createPackingItem, createDayNote } from '../helpers/factories';
import { TripsService } from '../../src/nest/trips/trips.service';
import { DatabaseService } from '../../src/nest/database/database.service';
import { authCookie } from '../helpers/auth';
import { invalidatePermissionsCache } from '../../src/nest/permissions/permissions-cache';

let nestApp: INestApplication;
let app: Application;

beforeAll(async () => {
  createTables(testDb);
  runMigrations(testDb);
  nestApp = await buildApp();
  app = nestApp.getHttpAdapter().getInstance();
});
beforeEach(() => {
  resetTestDb(testDb);
  resetRateLimits(nestApp);
  invalidatePermissionsCache();
});
afterAll(async () => {
  await nestApp.close();
  testDb.close();
});


// ── helpers ───────────────────────────────────────────────────────────────

const as = (userId: number) => ({ Cookie: authCookie(userId) });
const publish = (tripId: number, ownerId: number, isPublic = true) =>
  request(app).put(`/api/trips/${tripId}/visibility`).set(as(ownerId)).send({ is_public: isPublic });
const flush = () => new Promise((r) => setTimeout(r, 25));
// Rows carry the i18n keys, not the event name, so an event is found by its title key.
const notificationsFor = (userId: number, event?: string) =>
  testDb.prepare(`SELECT * FROM notifications WHERE recipient_id = ?${event ? ' AND title_key = ?' : ''} ORDER BY id`)
    .all(...(event ? [userId, `notif.${event}.title`] : [userId])) as any[];

/** An owner, a member, a stranger, and a published trip with one of everything private. */
function seedPublicTrip() {
  const { user: owner } = createUser(testDb);
  const { user: member } = createUser(testDb);
  const { user: visitor } = createUser(testDb);
  const trip = createTrip(testDb, owner.id, { title: 'Iceland ring road', start_date: '2026-08-01', end_date: '2026-08-03' });
  addTripMember(testDb, trip.id, member.id);
  const day = testDb.prepare('SELECT id FROM days WHERE trip_id = ? ORDER BY day_number').get(trip.id) as { id: number };
  testDb.prepare('UPDATE days SET notes = ? WHERE id = ?').run('owner-only day note', day.id);
  createDayNote(testDb, day.id, trip.id, { text: 'private day note item' });
  const place = createPlace(testDb, trip.id, { name: 'Gullfoss' });
  testDb.prepare('UPDATE places SET notes = ? WHERE id = ?').run('ask for Marie', place.id);
  testDb.prepare('INSERT INTO day_assignments (day_id, place_id, notes) VALUES (?, ?, ?)').run(day.id, place.id, 'assignment note');
  const reservation = createReservation(testDb, trip.id, { title: 'Flight KEF' });
  testDb.prepare('UPDATE reservations SET confirmation_number = ?, notes = ?, metadata = ? WHERE id = ?')
    .run('CONF-123', 'seat 4A', '{"pnr":"ZZZ"}', reservation.id);
  createBudgetItem(testDb, trip.id, { name: 'Car rental', total_price: 900 });
  createPackingItem(testDb, trip.id, { name: 'Passport' });
  return { owner, member, visitor, trip, day, place, reservation };
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishing
// ─────────────────────────────────────────────────────────────────────────────

describe('Visibility', () => {
  it('PUBTRIP-001 — the owner publishes and unpublishes; GET reports the state', async () => {
    const { owner, trip } = seedPublicTrip();
    expect((await request(app).get(`/api/trips/${trip.id}/visibility`).set(as(owner.id))).body).toEqual({ is_public: false, is_owner: true });

    expect((await publish(trip.id, owner.id)).body).toEqual({ is_public: true });
    expect((await request(app).get(`/api/trips/${trip.id}/visibility`).set(as(owner.id))).body.is_public).toBe(true);

    expect((await publish(trip.id, owner.id, false)).body).toEqual({ is_public: false });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_public_visibility').get()).toEqual({ n: 0 });
  });

  it('PUBTRIP-002 — only the owner can change it: a member is 403, a stranger 404', async () => {
    const { member, visitor, trip } = seedPublicTrip();
    expect((await publish(trip.id, member.id)).status).toBe(403);
    expect((await publish(trip.id, visitor.id)).status).toBe(404);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_public_visibility').get()).toEqual({ n: 0 });
  });

  it('PUBTRIP-003 — a non-boolean body is rejected', async () => {
    const { owner, trip } = seedPublicTrip();
    const res = await request(app).put(`/api/trips/${trip.id}/visibility`).set(as(owner.id)).send({ is_public: 'yes' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

describe('Discovery', () => {
  it('PUBTRIP-010 — a published trip shows on a stranger\'s dashboard as read-only; a private one does not', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    const privateTrip = createTrip(testDb, owner.id, { title: 'Secret' });
    await publish(trip.id, owner.id);

    const res = await request(app).get('/api/trips').set(as(visitor.id));
    expect(res.status).toBe(200);
    const ids = res.body.trips.map((t: any) => t.id);
    expect(ids).toContain(trip.id);
    expect(ids).not.toContain(privateTrip.id);
    expect(res.body.trips.find((t: any) => t.id === trip.id)).toMatchObject({ is_viewer: 1, is_public: 1, join_request_status: null });
  });

  it('PUBTRIP-011 — the owner and members see their own trip as theirs, not as a visitor', async () => {
    const { owner, member, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    for (const u of [owner, member]) {
      const t = (await request(app).get('/api/trips').set(as(u.id))).body.trips.find((x: any) => x.id === trip.id);
      expect(t).toMatchObject({ is_viewer: 0, is_public: 1 });
    }
  });

  it('PUBTRIP-012 — the archived list honours the flag too', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    testDb.prepare('UPDATE trips SET is_archived = 1 WHERE id = ?').run(trip.id);
    expect((await request(app).get('/api/trips').set(as(visitor.id))).body.trips.map((t: any) => t.id)).not.toContain(trip.id);
    expect((await request(app).get('/api/trips?archived=1').set(as(visitor.id))).body.trips.map((t: any) => t.id)).toContain(trip.id);
  });

  it('PUBTRIP-013 — the trip itself opens for a visitor and never carries the calendar-feed credential', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    testDb.prepare('UPDATE trips SET feed_token = ? WHERE id = ?').run('secret-feed-token', trip.id);
    await publish(trip.id, owner.id);

    const res = await request(app).get(`/api/trips/${trip.id}`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ id: trip.id, title: 'Iceland ring road', is_viewer: 1 });
    expect(res.body.trip.feed_token ?? null).toBeNull();
    const list = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: any) => t.id === trip.id);
    expect(list.feed_token ?? null).toBeNull();
  });

  it('PUBTRIP-014 — an unpublished trip is a 404 for a stranger, and unpublishing closes it again', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    expect((await request(app).get(`/api/trips/${trip.id}`).set(as(visitor.id))).status).toBe(404);
    await publish(trip.id, owner.id);
    expect((await request(app).get(`/api/trips/${trip.id}`).set(as(visitor.id))).status).toBe(200);
    await publish(trip.id, owner.id, false);
    expect((await request(app).get(`/api/trips/${trip.id}`).set(as(visitor.id))).status).toBe(404);
    expect((await request(app).get(`/api/trips/${trip.id}/days`).set(as(visitor.id))).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What a visitor can read
// ─────────────────────────────────────────────────────────────────────────────

describe('Visitor reads', () => {
  it('PUBTRIP-020 — the itinerary is readable but day and assignment notes are blanked', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);

    const res = await request(app).get(`/api/trips/${trip.id}/days`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    const first = res.body.days[0];
    expect(first.date).toBe('2026-08-01');
    expect(first.notes).toBeNull();
    expect(first.notes_items).toEqual([]);
    expect(first.assignments[0]).toMatchObject({ notes: null, participants: [], place: { name: 'Gullfoss', notes: null } });
    expect(JSON.stringify(res.body)).not.toMatch(/owner-only day note|private day note item|ask for Marie|assignment note/);
  });

  it('PUBTRIP-021 — places keep their name and position but lose their notes', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    const res = await request(app).get(`/api/trips/${trip.id}/places`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.places[0]).toMatchObject({ name: 'Gullfoss', notes: null });
    // the same endpoint still returns the notes to a member
    const asMember = await request(app).get(`/api/trips/${trip.id}/places`).set(as(owner.id));
    expect(asMember.body.places[0].notes).toBe('ask for Marie');
  });

  it('PUBTRIP-022 — reservations show what and when, never the booking code, notes or metadata', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    const res = await request(app).get(`/api/trips/${trip.id}/reservations`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.reservations[0]).toMatchObject({ title: 'Flight KEF', confirmation_number: null, notes: null, metadata: null });
    expect(JSON.stringify(res.body)).not.toMatch(/CONF-123|seat 4A|ZZZ/);
    const asOwner = await request(app).get(`/api/trips/${trip.id}/reservations`).set(as(owner.id));
    expect(asOwner.body.reservations[0].confirmation_number).toBe('CONF-123');
  });

  it('PUBTRIP-023 — accommodations are readable and redacted', async () => {
    const { owner, visitor, trip, place, day } = seedPublicTrip();
    testDb.prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id, confirmation, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(trip.id, place.id, day.id, day.id, 'HOTEL-99', 'late check-in');
    await publish(trip.id, owner.id);
    const res = await request(app).get(`/api/trips/${trip.id}/accommodations`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.accommodations[0]).toMatchObject({ confirmation: null, notes: null });
  });

  it.each([
    ['packing', 'packing'],
    ['todo', 'todo'],
    ['budget', 'budget'],
    ['files', 'files'],
    ['collab notes', 'collab/notes'],
    ['members', 'members'],
    ['offline bundle', 'bundle'],
    ['calendar export', 'export.ics'],
    ['a single place', 'places/__PLACE__'],
    ['day participants', 'days/__DAY__/assignments'],
  ])('PUBTRIP-024 — %s is not readable by a visitor', async (_name, path) => {
    const { owner, visitor, trip, place, day } = seedPublicTrip();
    await publish(trip.id, owner.id);
    const url = `/api/trips/${trip.id}/${path.replace('__PLACE__', String(place.id)).replace('__DAY__', String(day.id))}`;
    const res = await request(app).get(url).set(as(visitor.id));
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/Car rental|Passport|CONF-123/);
  });

  it('PUBTRIP-025 — a visitor cannot write anything, on any itinerary route', async () => {
    const { owner, visitor, trip, place, day, reservation } = seedPublicTrip();
    await publish(trip.id, owner.id);
    const base = `/api/trips/${trip.id}`;
    const attempts: Array<[string, string, object?]> = [
      ['post', `${base}/places`, { name: 'Hacked' }],
      ['put', `${base}/places/${place.id}`, { name: 'Hacked' }],
      ['delete', `${base}/places/${place.id}`],
      ['post', `${base}/days`, {}],
      ['put', `${base}/days/${day.id}`, { notes: 'x' }],
      ['delete', `${base}/days/${day.id}`],
      ['post', `${base}/reservations`, { title: 'x' }],
      ['put', `${base}/reservations/${reservation.id}`, { title: 'x' }],
      ['delete', `${base}/reservations/${reservation.id}`],
      ['post', `${base}/packing`, { name: 'x' }],
      ['post', `${base}/budget`, { name: 'x' }],
      ['put', base, { title: 'Hijacked' }],
      ['delete', base],
      ['post', `${base}/members`, { identifier: 'someone' }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await (request(app) as any)[method](url).set(as(visitor.id)).send(body);
      expect([403, 404], `${method.toUpperCase()} ${url} → ${res.status}`).toContain(res.status);
    }
    expect(testDb.prepare('SELECT title FROM trips WHERE id = ?').get(trip.id)).toEqual({ title: 'Iceland ring road' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM places WHERE trip_id = ?').get(trip.id)).toEqual({ n: 1 });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ?').get(trip.id)).toEqual({ n: 1 });
  });

  it('PUBTRIP-026 — publishing a trip does not widen what its members\' own routes answer', async () => {
    const { owner, member, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    expect((await request(app).get(`/api/trips/${trip.id}/packing`).set(as(member.id))).status).toBe(200);
    expect((await request(app).get(`/api/trips/${trip.id}/budget`).set(as(owner.id))).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not widening the access predicates
// ─────────────────────────────────────────────────────────────────────────────

describe('Access predicates stay member-only', () => {
  it('PUBTRIP-030 — canAccessTrip, TripsService.list and .get ignore the public flag (MCP and plugins call them)', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);

    expect(nestApp.get(DatabaseService).canAccessTrip(trip.id, visitor.id)).toBeUndefined();
    const trips = nestApp.get(TripsService, { strict: false });
    expect((trips.list(visitor.id, null) as any[]).map((t) => t.id)).not.toContain(trip.id);
    expect(trips.get(trip.id, visitor.id)).toBeUndefined();
    // while the dashboard view does include it
    expect((trips.listWithPublic(visitor.id, null) as any[]).map((t) => t.id)).toContain(trip.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Join requests
// ─────────────────────────────────────────────────────────────────────────────

describe('Join requests', () => {
  const ask = (tripId: number, userId: number) => request(app).post(`/api/trips/${tripId}/join-request`).set(as(userId));

  it('PUBTRIP-040 — asking creates one pending request and one boolean notification for the owner', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);

    const res = await ask(trip.id, visitor.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending' });
    await flush();

    const [n, ...rest] = notificationsFor(owner.id, 'trip_join_request');
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({ type: 'boolean', scope: 'user', sender_id: visitor.id });
    expect(JSON.parse(n.positive_callback)).toEqual({ action: 'join_request_accept', payload: { tripId: trip.id, userId: visitor.id } });
    expect(JSON.parse(n.title_params)).toMatchObject({ trip: 'Iceland ring road' });

    // the trip card now says pending
    const t = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((x: any) => x.id === trip.id);
    expect(t.join_request_status).toBe('pending');
  });

  it('PUBTRIP-041 — asking twice is idempotent: still one pending row, still one notification', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const again = await ask(trip.id, visitor.id);
    expect(again.body).toEqual({ status: 'pending' });
    await flush();
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_join_requests').get()).toEqual({ n: 1 });
    expect(notificationsFor(owner.id, 'trip_join_request')).toHaveLength(1);
  });

  it('PUBTRIP-042 — you cannot ask to join a private trip, or one you already belong to', async () => {
    const { owner, member, visitor, trip } = seedPublicTrip();
    expect((await ask(trip.id, visitor.id)).status).toBe(404);          // not public
    await publish(trip.id, owner.id);
    expect((await ask(trip.id, member.id)).status).toBe(400);           // already a member
    expect((await ask(trip.id, owner.id)).status).toBe(400);            // the owner
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_join_requests').get()).toEqual({ n: 0 });
  });

  it('PUBTRIP-043 — the requester can cancel while pending, once', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    expect((await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).body).toEqual({ success: true });
    expect((await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).status).toBe(404);
    expect((await request(app).get(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).body).toEqual({ status: null });
    // and may ask again afterwards
    expect((await ask(trip.id, visitor.id)).status).toBe(200);
  });

  it('PUBTRIP-044 — only the owner sees and decides requests', async () => {
    const { owner, member, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const listed = await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id));
    expect(listed.body.requests).toHaveLength(1);
    expect(listed.body.requests[0]).toMatchObject({ user_id: visitor.id, status: 'pending' });
    const id = listed.body.requests[0].id;

    for (const who of [member, visitor]) {
      expect([403, 404]).toContain((await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(who.id))).status);
      expect([403, 404]).toContain((await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(who.id))).status);
    }
    expect(testDb.prepare("SELECT status FROM trip_join_requests WHERE id = ?").get(id)).toEqual({ status: 'pending' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE user_id = ?').get(visitor.id)).toEqual({ n: 0 });
  });

  it('PUBTRIP-045 — accepting from the dialog adds the member, opens the trip fully, and tells the requester', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;

    const res = await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id));
    expect(res.body).toEqual({ success: true, user_id: visitor.id });
    await flush();

    expect(testDb.prepare('SELECT invited_by FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, visitor.id)).toEqual({ invited_by: owner.id });
    // now a member: the private tabs open and the trip is theirs
    expect((await request(app).get(`/api/trips/${trip.id}/packing`).set(as(visitor.id))).status).toBe(200);
    expect((await request(app).get(`/api/trips/${trip.id}/places`).set(as(visitor.id))).body.places[0].notes).toBe('ask for Marie');
    expect((await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: any) => t.id === trip.id)).toMatchObject({ is_viewer: 0 });
    // the requester was notified, with a link to the trip — decision: always, not only from the notification buttons
    const [n] = notificationsFor(visitor.id, 'trip_join_accepted');
    expect(n).toMatchObject({ type: 'navigate', navigate_target: `/trips/${trip.id}` });
    // and it cannot be resolved twice
    expect((await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id))).status).toBe(404);
  });

  it('PUBTRIP-046 — rejecting from the dialog tells the requester and they may ask again at once', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;

    expect((await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/reject`).set(as(owner.id))).status).toBe(200);
    await flush();
    expect(notificationsFor(visitor.id, 'trip_join_rejected')).toHaveLength(1);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE user_id = ?').get(visitor.id)).toEqual({ n: 0 });
    // still a visitor, with the card back to "request to join" (rejected is not shown as a state)
    expect((await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: any) => t.id === trip.id))
      .toMatchObject({ is_viewer: 1, join_request_status: 'rejected' });

    expect((await ask(trip.id, visitor.id)).status).toBe(200);
    expect(testDb.prepare('SELECT status FROM trip_join_requests').get()).toEqual({ status: 'pending' });
    await flush();
    expect(notificationsFor(owner.id, 'trip_join_request')).toHaveLength(2);
  });

  it('PUBTRIP-047 — the Accept button on the owner\'s notification does the same thing', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = notificationsFor(owner.id, 'trip_join_request');

    const res = await request(app).post(`/api/notifications/in-app/${n.id}/respond`).set(as(owner.id)).send({ response: 'positive' });
    expect(res.body.success).toBe(true);
    await flush();
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND user_id = ?').get(trip.id, visitor.id)).toEqual({ n: 1 });
    expect(testDb.prepare('SELECT status FROM trip_join_requests').get()).toEqual({ status: 'accepted' });
    expect(notificationsFor(visitor.id, 'trip_join_accepted')).toHaveLength(1);
  });

  it('PUBTRIP-048 — the Reject button on the notification rejects and notifies', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = notificationsFor(owner.id, 'trip_join_request');
    await request(app).post(`/api/notifications/in-app/${n.id}/respond`).set(as(owner.id)).send({ response: 'negative' });
    await flush();
    expect(testDb.prepare('SELECT status FROM trip_join_requests').get()).toEqual({ status: 'rejected' });
    expect(notificationsFor(visitor.id, 'trip_join_rejected')).toHaveLength(1);
  });

  it('PUBTRIP-049 — a stale Accept never re-adds someone: cancelled, or already decided elsewhere', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = notificationsFor(owner.id, 'trip_join_request');

    // the requester withdraws, then the owner clicks the old Accept
    await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id));
    await request(app).post(`/api/notifications/in-app/${n.id}/respond`).set(as(owner.id)).send({ response: 'positive' });
    await flush();
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE user_id = ?').get(visitor.id)).toEqual({ n: 0 });
    expect(notificationsFor(visitor.id, 'trip_join_accepted')).toHaveLength(0);
  });

  it('PUBTRIP-050 — a removed member can ask again; a stale "accepted" row does not block them', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;
    await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id));
    await request(app).delete(`/api/trips/${trip.id}/members/${visitor.id}`).set(as(owner.id));

    const card = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: any) => t.id === trip.id);
    expect(card).toMatchObject({ is_viewer: 1, join_request_status: null });
    expect((await ask(trip.id, visitor.id)).status).toBe(200);
    expect(testDb.prepare('SELECT status FROM trip_join_requests').get()).toEqual({ status: 'pending' });
  });

  it('PUBTRIP-051 — unpublishing withdraws pending requests so nothing can be accepted into a closed trip', async () => {
    const { owner, visitor, trip } = seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = notificationsFor(owner.id, 'trip_join_request');
    await publish(trip.id, owner.id, false);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_join_requests').get()).toEqual({ n: 0 });

    await request(app).post(`/api/notifications/in-app/${n.id}/respond`).set(as(owner.id)).send({ response: 'positive' });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM trip_members WHERE user_id = ?').get(visitor.id)).toEqual({ n: 0 });
  });

  it('PUBTRIP-052 — the notification preferences list the three new events', async () => {
    const { user } = createUser(testDb);
    const res = await request(app).get('/api/notifications/preferences').set(as(user.id));
    expect(res.body.event_types).toEqual(expect.arrayContaining(['trip_join_request', 'trip_join_accepted', 'trip_join_rejected']));
  });
});
