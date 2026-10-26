import {
  tripJoinRequestListResponseSchema,
  tripVisibilityResponseSchema,
  type TripVisibilityRequest,
} from '@trek/shared';
import { apiClient } from '../api/client';

/**
 * Publishing a trip read-only and asking to join one. Online only on purpose: both
 * are decisions between two people, not a draft to replay once the connection is back.
 */
export const tripPublicRepo = {
  async getVisibility(tripId: number | string) {
    const { data } = await apiClient.get(`/trips/${tripId}/visibility`);
    return tripVisibilityResponseSchema.parse(data);
  },

  async setVisibility(tripId: number | string, isPublic: boolean) {
    const body: TripVisibilityRequest = { is_public: isPublic };
    const { data } = await apiClient.put(`/trips/${tripId}/visibility`, body);
    return tripVisibilityResponseSchema.parse(data);
  },

  async requestJoin(tripId: number | string) {
    await apiClient.post(`/trips/${tripId}/join-request`);
  },

  async cancelJoin(tripId: number | string) {
    await apiClient.delete(`/trips/${tripId}/join-request`);
  },

  async listJoinRequests(tripId: number | string) {
    const { data } = await apiClient.get(`/trips/${tripId}/join-requests`);
    return tripJoinRequestListResponseSchema.parse(data).requests;
  },

  async acceptJoinRequest(tripId: number | string, requestId: number) {
    await apiClient.post(`/trips/${tripId}/join-requests/${requestId}/accept`);
  },

  async rejectJoinRequest(tripId: number | string, requestId: number) {
    await apiClient.post(`/trips/${tripId}/join-requests/${requestId}/reject`);
  },
};
