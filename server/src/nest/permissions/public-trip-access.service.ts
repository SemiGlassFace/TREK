import { TripPublicVisibility } from '../../db/entities/TripPublicVisibility.entity';
import type { TripPublicVisibilityRepository } from '../../db/repositories/TripPublicVisibility.repository';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

/**
 * Whether a trip is public, and the public view of trips. Lives with the permissions
 * domain because it is the other half of what TripAccessGuard decides: a signed-in
 * non-member may read a trip its owner published, through `@ViewerReadable()` handlers
 * only. Deliberately NOT part of TripAccessService (trip-membership), which the MCP
 * tools and the plugin RPC call and which must keep meaning "members only".
 */
@Injectable()
export class PublicTripAccessService {
  constructor(@InjectRepository(TripPublicVisibility) private readonly visibility: TripPublicVisibilityRepository) {}

  isPublic(tripId: number) {
    return this.visibility.isPublic(tripId);
  }

  publish(tripId: number, userId: number) {
    return this.visibility.publish(tripId, userId);
  }

  unpublish(tripId: number) {
    return this.visibility.unpublish(tripId);
  }

  /** The access row of a published trip, flagged `is_viewer`, or undefined when it is private or gone. */
  findPublicTrip(tripId: number) {
    return this.visibility.findPublicTrip(tripId);
  }

  /** Everything `TripsService.list` returns plus public trips of other owners, flagged `is_viewer`. */
  listTrips(userId: number, archived: number | null) {
    return this.visibility.listTrips(userId, archived);
  }

  /** `TripsService.get` that also opens a public trip of another owner, flagged `is_viewer`. */
  findTrip(tripId: string | number, userId: number) {
    return this.visibility.findTrip(tripId, userId);
  }
}
