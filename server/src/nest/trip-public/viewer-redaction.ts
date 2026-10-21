/**
 * What a read-only visitor of a public trip does NOT get to see.
 *
 * Pure functions, no imports: a visitor is not a member, so anything the owner
 * wrote for the group (notes, booking codes, who is travelling) stays behind.
 * The itinerary itself — days, places, times, the shape of the bookings — is
 * what "public" means.
 *
 * A deny-list rather than an allow-list on purpose: the rows are SELECT * shaped
 * and the client reads most columns. The cost is that a column added to these
 * tables later is visible by default, so the tests pin the fields below and a
 * new private column needs a line here.
 */

type Row = Record<string, unknown>;

export function redactPlaceForViewer<T extends Row>(place: T): T {
  return { ...place, notes: null };
}

export function redactPlacesForViewer<T extends Row>(places: T[]): T[] {
  return places.map(redactPlaceForViewer);
}

export function redactReservationsForViewer<T extends Row>(reservations: T[]): T[] {
  return reservations.map((r) => ({
    ...r,
    confirmation_number: null,
    notes: null,
    metadata: null,
    url: null,
    external_id: null,
    external_hash: null,
    external_owner_user_id: null,
    travelers: [],
  }));
}

export function redactAccommodationsForViewer(accommodations: unknown[]): unknown[] {
  return accommodations.map((a) => ({ ...(a as Row), confirmation: null, notes: null }));
}

export function redactDaysForViewer<T extends { days: Row[] }>(result: T): T {
  return {
    ...result,
    days: result.days.map((day) => ({
      ...day,
      notes: null,
      notes_items: [],
      // An assignment embeds its place (formatAssignmentWithPlace), so the place's own
      // notes ride along inside it and need the same treatment as the places list.
      assignments: ((day.assignments as Row[] | undefined) ?? []).map((a) => ({
        ...a,
        notes: null,
        participants: [],
        place: a.place && typeof a.place === 'object' ? redactPlaceForViewer(a.place as Row) : a.place,
      })),
    })),
  };
}
