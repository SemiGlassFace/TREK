/**
 * Public trips: publishing a trip read-only, what a visitor can and cannot reach,
 * and the join-request lifecycle (PUBTRIP-xxx).
 *
 * Runs the real app on the real schema. The point of most cases is a negative: a
 * visitor is not a member, so the proof is that nothing outside the itinerary opens.
 */
import { buildApp } from '../../src/bootstrap';
import { Days } from '../../src/db/entities/Days.entity';
import { Notifications } from '../../src/db/entities/Notifications.entity';
import { Places } from '../../src/db/entities/Places.entity';
import { TripJoinRequests } from '../../src/db/entities/TripJoinRequests.entity';
import { TripMembers } from '../../src/db/entities/TripMembers.entity';
import { TripPublicVisibility } from '../../src/db/entities/TripPublicVisibility.entity';
import { Trips } from '../../src/db/entities/Trips.entity';
import { TripAccessService } from '../../src/nest/trip-membership/trip-access.service';
import { TripPublicService } from '../../src/nest/trip-public/trip-public.service';
import { TripsService } from '../../src/nest/trips/trips.service';
import { authCookie } from '../helpers/auth';
import { makeBudgetItem } from '../helpers/factories/budget';
import type { FactoryOrm } from '../helpers/factories/context';
import { inContext } from '../helpers/factories/context';
import { makeDayAccommodation, makeDayAssignment, makeDayNote } from '../helpers/factories/itinerary';
import { makePackingItem } from '../helpers/factories/packing';
import { makePlace } from '../helpers/factories/places';
import { makeReservation } from '../helpers/factories/reservations';
import { countRows, findRow, findRows, updateRows } from '../helpers/factories/rows';
import { addTripMember, makeTrip, readTripDays } from '../helpers/factories/trips';
import { makeUser } from '../helpers/factories/users';
import { MikroORM } from '@mikro-orm/core';
import type { INestApplication } from '@nestjs/common';

import type { Application } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let nestApp: INestApplication;
let app: Application;
let orm: FactoryOrm;

beforeAll(async () => {
  nestApp = await buildApp();
  app = nestApp.getHttpAdapter().getInstance();
  orm = nestApp.get(MikroORM);
});
afterAll(async () => {
  await nestApp.close();
});

type TripCard = {
  id: number;
  is_viewer: number;
  is_public: number;
  join_request_status: string | null;
  feed_token?: string | null;
};
const tripsOf = (res: { body: { trips: TripCard[] } }) => res.body.trips;

// ── helpers ───────────────────────────────────────────────────────────────

const as = (userId: number) => ({ Cookie: authCookie(userId) });
const publish = (tripId: number, ownerId: number, isPublic = true) =>
  request(app).put(`/api/trips/${tripId}/visibility`).set(as(ownerId)).send({ is_public: isPublic });
const flush = () => new Promise((r) => setTimeout(r, 50));
// Rows carry the i18n keys, not the event name, so an event is found by its title key.
const notificationsFor = (userId: number, event?: string) =>
  findRows(
    orm,
    Notifications,
    { recipient_id: userId, ...(event ? { title_key: `notif.${event}.title` } : {}) },
    { id: 'asc' },
  );
const joinRequests = (tripId: number) => findRows(orm, TripJoinRequests, { trip: tripId });
const memberships = (userId: number) => countRows(orm, TripMembers, { user_id: userId });

/** An owner, a member, a stranger, and a published trip with one of everything private. */
async function seedPublicTrip() {
  const { user: owner } = await makeUser(orm);
  const { user: member } = await makeUser(orm);
  const { user: visitor } = await makeUser(orm);
  const trip = await makeTrip(orm, owner.id, {
    title: 'Iceland ring road',
    start_date: '2026-08-01',
    end_date: '2026-08-03',
  });
  await addTripMember(orm, trip.id, member.id);
  const [day] = await readTripDays(orm, trip.id);
  await updateRows(orm, Days, { id: day.id }, { notes: 'owner-only day note' });
  await makeDayNote(orm, day.id, trip.id, { text: 'private day note item' });
  const place = await makePlace(orm, trip.id, {
    name: 'Gullfoss',
    notes: 'ask for Marie',
    reservation_notes: 'call ahead',
  });
  await makeDayAssignment(orm, day.id, place.id, { notes: 'assignment note' });
  const reservation = await makeReservation(orm, trip.id, {
    title: 'Flight KEF',
    confirmation_number: 'CONF-123',
    notes: 'seat 4A',
    metadata: '{"pnr":"ZZZ"}',
  });
  await makeBudgetItem(orm, trip.id, { name: 'Car rental', total_price: 900 });
  await makePackingItem(orm, trip.id, { name: 'Passport' });
  return { owner, member, visitor, trip, day, place, reservation };
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishing
// ─────────────────────────────────────────────────────────────────────────────

describe('Visibility', () => {
  it('PUBTRIP-001 — the owner publishes and unpublishes; GET reports the state', async () => {
    const { owner, trip } = await seedPublicTrip();
    expect((await request(app).get(`/api/trips/${trip.id}/visibility`).set(as(owner.id))).body).toEqual({
      is_public: false,
      is_owner: true,
    });

    expect((await publish(trip.id, owner.id)).body).toEqual({ is_public: true });
    expect((await request(app).get(`/api/trips/${trip.id}/visibility`).set(as(owner.id))).body.is_public).toBe(true);

    expect((await publish(trip.id, owner.id, false)).body).toEqual({ is_public: false });
    expect(await countRows(orm, TripPublicVisibility, { trip: trip.id })).toBe(0);
  });

  it('PUBTRIP-002 — only the owner can change it: a member is 403, a stranger 404', async () => {
    const { member, visitor, trip } = await seedPublicTrip();
    expect((await publish(trip.id, member.id)).status).toBe(403);
    expect((await publish(trip.id, visitor.id)).status).toBe(404);
    expect(await countRows(orm, TripPublicVisibility, { trip: trip.id })).toBe(0);
  });

  it('PUBTRIP-003 — a non-boolean body is rejected', async () => {
    const { owner, trip } = await seedPublicTrip();
    const res = await request(app).put(`/api/trips/${trip.id}/visibility`).set(as(owner.id)).send({ is_public: 'yes' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

describe('Discovery', () => {
  it("PUBTRIP-010 — a published trip shows on a stranger's dashboard as read-only; a private one does not", async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    const privateTrip = await makeTrip(orm, owner.id, { title: 'Secret' });
    await publish(trip.id, owner.id);

    const res = await request(app).get('/api/trips').set(as(visitor.id));
    expect(res.status).toBe(200);
    const ids = tripsOf(res).map((t: TripCard) => t.id);
    expect(ids).toContain(trip.id);
    expect(ids).not.toContain(privateTrip.id);
    expect(res.body.trips.find((t: TripCard) => t.id === trip.id)).toMatchObject({
      is_viewer: 1,
      is_public: 1,
      join_request_status: null,
    });
  });

  it('PUBTRIP-011 — the owner and members see their own trip as theirs, not as a visitor', async () => {
    const { owner, member, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    const cards = await Promise.all(
      [owner, member].map(async (u) =>
        tripsOf(await request(app).get('/api/trips').set(as(u.id))).find((x) => x.id === trip.id),
      ),
    );
    for (const card of cards) expect(card).toMatchObject({ is_viewer: 0, is_public: 1 });
  });

  it('PUBTRIP-012 — the archived list honours the flag too', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await updateRows(orm, Trips, { id: trip.id }, { is_archived: 1 });
    expect(
      (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.map((t: TripCard) => t.id),
    ).not.toContain(trip.id);
    expect(
      (await request(app).get('/api/trips?archived=1').set(as(visitor.id))).body.trips.map((t: TripCard) => t.id),
    ).toContain(trip.id);
  });

  it('PUBTRIP-013 — the trip itself opens for a visitor and never carries the calendar-feed credential', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await updateRows(orm, Trips, { id: trip.id }, { feed_token: 'secret-feed-token' });
    await publish(trip.id, owner.id);

    const res = await request(app).get(`/api/trips/${trip.id}`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ id: trip.id, title: 'Iceland ring road', is_viewer: 1 });
    expect(res.body.trip.feed_token ?? null).toBeNull();
    const list = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find(
      (t: TripCard) => t.id === trip.id,
    );
    expect(list.feed_token ?? null).toBeNull();
  });

  it('PUBTRIP-014 — an unpublished trip is a 404 for a stranger, and unpublishing closes it again', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
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
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);

    const res = await request(app).get(`/api/trips/${trip.id}/days`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    const first = res.body.days[0];
    expect(first.date).toBe('2026-08-01');
    expect(first.notes).toBeNull();
    expect(first.notes_items).toEqual([]);
    expect(first.assignments[0]).toMatchObject({
      notes: null,
      participants: [],
      place: { name: 'Gullfoss', notes: null },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /owner-only day note|private day note item|ask for Marie|assignment note/,
    );
  });

  it('PUBTRIP-021 — places keep their name and position but lose their notes', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    const res = await request(app).get(`/api/trips/${trip.id}/places`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.places[0]).toMatchObject({ name: 'Gullfoss', notes: null, reservation_notes: null, ratings: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/ask for Marie|call ahead/);
    // the same endpoint still returns the notes to a member
    const asMember = await request(app).get(`/api/trips/${trip.id}/places`).set(as(owner.id));
    expect(asMember.body.places[0].notes).toBe('ask for Marie');
  });

  it('PUBTRIP-022 — reservations show what and when, never the booking code, notes or metadata', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    const res = await request(app).get(`/api/trips/${trip.id}/reservations`).set(as(visitor.id));
    expect(res.status).toBe(200);
    expect(res.body.reservations[0]).toMatchObject({
      title: 'Flight KEF',
      confirmation_number: null,
      notes: null,
      metadata: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/CONF-123|seat 4A|ZZZ/);
    const asOwner = await request(app).get(`/api/trips/${trip.id}/reservations`).set(as(owner.id));
    expect(asOwner.body.reservations[0].confirmation_number).toBe('CONF-123');
  });

  it('PUBTRIP-023 — accommodations are readable and redacted', async () => {
    const { owner, visitor, trip, place, day } = await seedPublicTrip();
    await makeDayAccommodation(orm, trip.id, place.id, day.id, day.id, {
      confirmation: 'HOTEL-99',
      notes: 'late check-in',
    });
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
    const { owner, visitor, trip, place, day } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    const url = `/api/trips/${trip.id}/${path.replace('__PLACE__', String(place.id)).replace('__DAY__', String(day.id))}`;
    const res = await request(app).get(url).set(as(visitor.id));
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/Car rental|Passport|CONF-123/);
  });

  it('PUBTRIP-025 — a visitor cannot write anything, on any itinerary route', async () => {
    const { owner, visitor, trip, place, day, reservation } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    const base = `/api/trips/${trip.id}`;
    const attempts: Array<['post' | 'put' | 'delete', string, object?]> = [
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
    const answers = await Promise.all(
      attempts.map(async ([method, url, body]) => ({
        method,
        url,
        status: (await request(app)[method](url).set(as(visitor.id)).send(body)).status,
      })),
    );
    for (const { method, url, status } of answers) {
      expect([403, 404], `${method.toUpperCase()} ${url} → ${status}`).toContain(status);
    }
    expect((await findRow(orm, Trips, { id: trip.id }))?.title).toBe('Iceland ring road');
    expect(await countRows(orm, Places, { trip: trip.id })).toBe(1);
    expect(await countRows(orm, TripMembers, { trip: trip.id })).toBe(1);
  });

  it("PUBTRIP-026 — publishing a trip does not widen what its members' own routes answer", async () => {
    const { owner, member, trip } = await seedPublicTrip();
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
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);

    const trips = nestApp.get(TripsService, { strict: false });
    await inContext(orm, async () => {
      expect(
        await nestApp.get(TripAccessService, { strict: false }).findAccessible(trip.id, visitor.id),
      ).toBeUndefined();
      expect((await trips.list(visitor.id, null)).map((t) => t.id)).not.toContain(trip.id);
      expect(await trips.get(trip.id, visitor.id)).toBeUndefined();
      // while the dashboard view does include it
      expect(
        (await nestApp.get(TripPublicService, { strict: false }).listTrips(visitor.id, null)).map((t) => t.id),
      ).toContain(trip.id);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Join requests
// ─────────────────────────────────────────────────────────────────────────────

describe('Join requests', () => {
  const ask = (tripId: number, userId: number) =>
    request(app).post(`/api/trips/${tripId}/join-request`).set(as(userId));

  it('PUBTRIP-040 — asking creates one pending request and one boolean notification for the owner', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);

    const res = await ask(trip.id, visitor.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending' });
    await flush();

    const [n, ...rest] = await notificationsFor(owner.id, 'trip_join_request');
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({ type: 'boolean', scope: 'user', sender_id: visitor.id });
    expect(JSON.parse(n.positive_callback)).toEqual({
      action: 'join_request_accept',
      payload: { tripId: trip.id, userId: visitor.id },
    });
    expect(JSON.parse(n.title_params)).toMatchObject({ trip: 'Iceland ring road' });

    // the trip card now says pending
    const t = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find(
      (x: TripCard) => x.id === trip.id,
    );
    expect(t.join_request_status).toBe('pending');
  });

  it('PUBTRIP-041 — asking twice is idempotent: still one pending row, still one notification', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const again = await ask(trip.id, visitor.id);
    expect(again.body).toEqual({ status: 'pending' });
    await flush();
    expect(await countRows(orm, TripJoinRequests, { trip: trip.id })).toBe(1);
    expect(await notificationsFor(owner.id, 'trip_join_request')).toHaveLength(1);
  });

  it('PUBTRIP-042 — you cannot ask to join a private trip, or one you already belong to', async () => {
    const { owner, member, visitor, trip } = await seedPublicTrip();
    expect((await ask(trip.id, visitor.id)).status).toBe(404); // not public
    await publish(trip.id, owner.id);
    expect((await ask(trip.id, member.id)).status).toBe(400); // already a member
    expect((await ask(trip.id, owner.id)).status).toBe(400); // the owner
    expect(await countRows(orm, TripJoinRequests, { trip: trip.id })).toBe(0);
  });

  it('PUBTRIP-043 — the requester can cancel while pending, once', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    expect((await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).body).toEqual({
      success: true,
    });
    expect((await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).status).toBe(404);
    expect((await request(app).get(`/api/trips/${trip.id}/join-request`).set(as(visitor.id))).body).toEqual({
      status: null,
    });
    // and may ask again afterwards
    expect((await ask(trip.id, visitor.id)).status).toBe(200);
  });

  it('PUBTRIP-044 — only the owner sees and decides requests', async () => {
    const { owner, member, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const listed = await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id));
    expect(listed.body.requests).toHaveLength(1);
    expect(listed.body.requests[0]).toMatchObject({ user_id: visitor.id, status: 'pending' });
    const id = listed.body.requests[0].id;

    const refusals = await Promise.all(
      [member, visitor].flatMap((who) => [
        request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(who.id)),
        request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(who.id)),
      ]),
    );
    for (const res of refusals) expect([403, 404]).toContain(res.status);
    expect((await findRow(orm, TripJoinRequests, { id }))?.status).toBe('pending');
    expect(await memberships(visitor.id)).toBe(0);
  });

  it('PUBTRIP-045 — accepting from the dialog adds the member, opens the trip fully, and tells the requester', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;

    const res = await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id));
    expect(res.body).toEqual({ success: true, user_id: visitor.id });
    await flush();

    expect((await findRow(orm, TripMembers, { trip: trip.id, user: visitor.id }))?.invited_by).toBe(owner.id);
    // now a member: the private tabs open and the trip is theirs
    expect((await request(app).get(`/api/trips/${trip.id}/packing`).set(as(visitor.id))).status).toBe(200);
    expect((await request(app).get(`/api/trips/${trip.id}/places`).set(as(visitor.id))).body.places[0].notes).toBe(
      'ask for Marie',
    );
    expect(
      (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: TripCard) => t.id === trip.id),
    ).toMatchObject({ is_viewer: 0 });
    // the requester was notified, with a link to the trip — decision: always, not only from the notification buttons
    const [n] = await notificationsFor(visitor.id, 'trip_join_accepted');
    expect(n).toMatchObject({ type: 'navigate', navigate_target: `/trips/${trip.id}` });
    // and it cannot be resolved twice
    expect((await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id))).status).toBe(
      404,
    );
  });

  it('PUBTRIP-046 — rejecting from the dialog tells the requester and they may ask again at once', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;

    expect((await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/reject`).set(as(owner.id))).status).toBe(
      200,
    );
    await flush();
    expect(await notificationsFor(visitor.id, 'trip_join_rejected')).toHaveLength(1);
    expect(await memberships(visitor.id)).toBe(0);
    // still a visitor, with the card back to "request to join" (rejected is not shown as a state)
    expect(
      (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find((t: TripCard) => t.id === trip.id),
    ).toMatchObject({ is_viewer: 1, join_request_status: 'rejected' });

    expect((await ask(trip.id, visitor.id)).status).toBe(200);
    expect((await joinRequests(trip.id))[0].status).toBe('pending');
    await flush();
    expect(await notificationsFor(owner.id, 'trip_join_request')).toHaveLength(2);
  });

  it("PUBTRIP-047 — the Accept button on the owner's notification does the same thing", async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = await notificationsFor(owner.id, 'trip_join_request');

    const res = await request(app)
      .post(`/api/notifications/in-app/${n.id}/respond`)
      .set(as(owner.id))
      .send({ response: 'positive' });
    expect(res.body.success).toBe(true);
    await flush();
    expect(await memberships(visitor.id)).toBe(1);
    expect((await joinRequests(trip.id))[0].status).toBe('accepted');
    expect(await notificationsFor(visitor.id, 'trip_join_accepted')).toHaveLength(1);
  });

  it('PUBTRIP-048 — the Reject button on the notification rejects and notifies', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = await notificationsFor(owner.id, 'trip_join_request');
    await request(app)
      .post(`/api/notifications/in-app/${n.id}/respond`)
      .set(as(owner.id))
      .send({ response: 'negative' });
    await flush();
    expect((await joinRequests(trip.id))[0].status).toBe('rejected');
    expect(await notificationsFor(visitor.id, 'trip_join_rejected')).toHaveLength(1);
  });

  it('PUBTRIP-049 — a stale Accept never re-adds someone: cancelled, or already decided elsewhere', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = await notificationsFor(owner.id, 'trip_join_request');

    // the requester withdraws, then the owner clicks the old Accept
    await request(app).delete(`/api/trips/${trip.id}/join-request`).set(as(visitor.id));
    await request(app)
      .post(`/api/notifications/in-app/${n.id}/respond`)
      .set(as(owner.id))
      .send({ response: 'positive' });
    await flush();
    expect(await memberships(visitor.id)).toBe(0);
    expect(await notificationsFor(visitor.id, 'trip_join_accepted')).toHaveLength(0);
  });

  it('PUBTRIP-050 — a removed member can ask again; a stale "accepted" row does not block them', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    const id = (await request(app).get(`/api/trips/${trip.id}/join-requests`).set(as(owner.id))).body.requests[0].id;
    await request(app).post(`/api/trips/${trip.id}/join-requests/${id}/accept`).set(as(owner.id));
    await request(app).delete(`/api/trips/${trip.id}/members/${visitor.id}`).set(as(owner.id));

    const card = (await request(app).get('/api/trips').set(as(visitor.id))).body.trips.find(
      (t: TripCard) => t.id === trip.id,
    );
    expect(card).toMatchObject({ is_viewer: 1, join_request_status: null });
    expect((await ask(trip.id, visitor.id)).status).toBe(200);
    expect((await joinRequests(trip.id))[0].status).toBe('pending');
  });

  it('PUBTRIP-051 — unpublishing withdraws pending requests so nothing can be accepted into a closed trip', async () => {
    const { owner, visitor, trip } = await seedPublicTrip();
    await publish(trip.id, owner.id);
    await ask(trip.id, visitor.id);
    await flush();
    const [n] = await notificationsFor(owner.id, 'trip_join_request');
    await publish(trip.id, owner.id, false);
    expect(await countRows(orm, TripJoinRequests, { trip: trip.id })).toBe(0);

    await request(app)
      .post(`/api/notifications/in-app/${n.id}/respond`)
      .set(as(owner.id))
      .send({ response: 'positive' });
    expect(await memberships(visitor.id)).toBe(0);
  });

  it('PUBTRIP-052 — the notification preferences list the three new events', async () => {
    const { user } = await makeUser(orm);
    const res = await request(app).get('/api/notifications/preferences').set(as(user.id));
    expect(res.body.event_types).toEqual(
      expect.arrayContaining(['trip_join_request', 'trip_join_accepted', 'trip_join_rejected']),
    );
  });
});
