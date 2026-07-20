import { Injectable } from '@nestjs/common';
import { db, canAccessTrip } from '../../db/database';
import { broadcast } from '../../websocket';
import { checkPermission } from '../../services/permissions';
import type { User } from '../../types';
import * as tripSvc from '../../services/tripService';
import { listDays, listAccommodations } from '../../services/dayService';
import { listPlaces } from '../../services/placeService';
import { listItems as listPackingItems } from '../../services/packingService';
import { listItems as listTodoItems } from '../../services/todoService';
import { listBudgetItems, rebaseTripCurrency } from '../../services/budgetService';
import { listReservations } from '../../services/reservationService';
import { listFiles } from '../../services/fileService';
import { searchUnsplashPhotos, getUnsplashKey } from '../../services/unsplashService';

/**
 * Thin Nest wrapper around the existing trip service + the per-domain list
 * services used to build the offline bundle. Auth (canAccessTrip), permissions,
 * the SQL and the ICS export reuse the legacy code unchanged. Per-field
 * permission checks and audit logging stay in the controller (1:1 with the
 * legacy route).
 */
@Injectable()
export class TripsService {
  canAccessTrip(tripId: string, userId: number) {
    return canAccessTrip(tripId, userId) as { user_id: number } | null | undefined;
  }

  can(action: string, role: string, ownerId: number | null, userId: number, isMember: boolean): boolean {
    return checkPermission(action, role, ownerId, userId, isMember);
  }

  broadcast(tripId: string, event: string, payload: Record<string, unknown>, socketId: string | undefined): void {
    broadcast(tripId, event, payload, socketId);
  }

  list(userId: number, archived: number) {
    return tripSvc.listTrips(userId, archived);
  }

  create(userId: number, data: Parameters<typeof tripSvc.createTrip>[1]) {
    return tripSvc.createTrip(userId, data);
  }

  get(tripId: string, userId: number) {
    return tripSvc.getTrip(tripId, userId);
  }

  getRaw(tripId: string) {
    return tripSvc.getTripRaw(tripId);
  }

  searchCoverImages(query: string, userId: number) {
    return searchUnsplashPhotos(query, 9, getUnsplashKey(userId));
  }

  getOwner(tripId: string) {
    return tripSvc.getTripOwner(tripId);
  }

  async update(tripId: string, userId: number, body: Parameters<typeof tripSvc.updateTrip>[2], role: string) {
    // Re-anchor the budget while the outgoing currency is still on the trip row,
    // otherwise the frozen FX rates and the currency-less expenses that inherit the
    // trip's base are left pointing at a currency that no longer exists (#1543).
    await rebaseTripCurrency(tripId, body.currency);
    return tripSvc.updateTrip(tripId, userId, body, role);
  }

  remove(tripId: string, userId: number, role: string) {
    return tripSvc.deleteTrip(tripId, userId, role);
  }

  deleteOldCover(coverImage: string | null | undefined): void {
    tripSvc.deleteOldCover(coverImage as never);
  }

  updateCoverImage(tripId: string, url: string): void {
    tripSvc.updateCoverImage(tripId, url);
  }

  copy(tripId: string, userId: number, title?: string) {
    return tripSvc.copyTripById(tripId, userId, title);
  }

  /** Re-read a freshly copied trip in list shape (mirrors the route's TRIP_SELECT query). */
  getCopiedTrip(newTripId: number, userId: number) {
    return db.prepare(`${tripSvc.TRIP_SELECT} WHERE t.id = :tripId`).get({ userId, tripId: newTripId });
  }

  listMembers(tripId: string, ownerId: number) {
    return tripSvc.listMembers(tripId, ownerId);
  }

  addMember(tripId: string, identifier: string, ownerId: number, userId: number) {
    return tripSvc.addMember(tripId, identifier, ownerId, userId);
  }

  removeMember(tripId: string, targetId: number): void {
    tripSvc.removeMember(tripId, targetId);
  }

  transferOwnership(tripId: string, newOwnerId: number, currentOwnerId: number) {
    return tripSvc.transferOwnership(tripId, newOwnerId, currentOwnerId);
  }

  createGuest(tripId: string, name: string, invitedBy: number) {
    return tripSvc.createGuest(tripId, name, invitedBy);
  }

  renameGuest(tripId: string, guestUserId: number, name: string): boolean {
    return tripSvc.renameGuest(tripId, guestUserId, name);
  }

  deleteGuest(tripId: string, guestUserId: number): boolean {
    return tripSvc.deleteGuest(tripId, guestUserId);
  }

  exportICS(tripId: string) {
    return tripSvc.exportICS(tripId);
  }

  /** Aggregates every trip sub-collection for offline caching (legacy /:id/bundle). */
  bundle(tripId: string, trip: { user_id: number }) {
    const { days } = listDays(tripId);
    const { owner, members } = this.listMembers(tripId, trip.user_id);
    return {
      trip,
      days,
      places: listPlaces(String(tripId), {}),
      packingItems: listPackingItems(tripId),
      todoItems: listTodoItems(tripId),
      budgetItems: listBudgetItems(tripId),
      reservations: listReservations(tripId),
      files: listFiles(tripId, false),
      accommodations: listAccommodations(tripId),
      members: [owner, ...(members || [])].filter(Boolean),
    };
  }

  /** Fire-and-forget trip-invite notification (mirrors the route's dynamic import). */
  notifyInvite(tripId: string, actor: User, targetUserId: number, tripTitle: string, inviteeEmail: string): void {
    import('../../services/notificationService').then(({ send }) => {
      send({
        event: 'trip_invite',
        actorId: actor.id,
        scope: 'user',
        targetId: targetUserId,
        params: { trip: tripTitle, actor: actor.email, invitee: inviteeEmail, tripId: String(tripId) },
      }).catch(() => {});
    });
  }

  // ── Public visibility ─────────────────────────────────────────────────

  getVisibility(tripId: string): boolean {
    return tripSvc.getTripPublicVisibility(tripId);
  }

  setVisibility(tripId: string, isPublic: boolean, userId: number): void {
    tripSvc.setTripPublicVisibility(tripId, isPublic, userId);
  }

  // ── Join requests ─────────────────────────────────────────────────────

  getJoinRequestStatus(tripId: string, userId: number): string | null {
    return tripSvc.getJoinRequestStatus(tripId, userId);
  }

  getJoinRequests(tripId: string) {
    return tripSvc.getJoinRequests(tripId);
  }

  submitJoinRequest(tripId: string, userId: number): 'created' | 'pending' | 'accepted' {
    const result = tripSvc.submitJoinRequest(tripId, userId);
    if (result === 'created') {
      this.notifyJoinRequest(tripId, userId);
    }
    return result;
  }

  /** Fire-and-forget: notify the trip owner of a new join request with accept/reject actions. */
  private notifyJoinRequest(tripId: string, requesterId: number): void {
    import('../../services/notificationService').then(({ send }) => {
      const trip = tripSvc.getTripRaw(tripId);
      if (!trip) return;
      send({
        event: 'trip_join_request',
        actorId: requesterId,
        scope: 'user',
        targetId: trip.user_id,
        params: { tripId: String(tripId), userId: String(requesterId) },
        inApp: {
          type: 'boolean',
          positiveTextKey: 'notif.action.accept',
          negativeTextKey: 'notif.action.reject',
          positiveCallback: { action: 'join_request_accept', payload: { tripId: Number(tripId), userId: requesterId } },
          negativeCallback: { action: 'join_request_reject', payload: { tripId: Number(tripId), userId: requesterId } },
        },
      }).catch(() => {});
    });
  }

  acceptJoinRequest(tripId: string, requestId: number): number | null {
    return tripSvc.acceptJoinRequest(tripId, requestId);
  }

  rejectJoinRequest(tripId: string, requestId: number): number | null {
    return tripSvc.rejectJoinRequest(tripId, requestId);
  }

  cancelJoinRequest(tripId: string, userId: number): boolean {
    return tripSvc.cancelJoinRequest(tripId, userId);
  }
}
