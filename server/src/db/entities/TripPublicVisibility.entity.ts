import { EntityRepositoryType, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { TripPublicVisibilityRepository } from '../repositories/TripPublicVisibility.repository';
import { DbTimestampType } from '../types';
import { Trips } from './Trips.entity';
import { Users } from './Users.entity';

export class TripPublicVisibility {
  [EntityRepositoryType]?: TripPublicVisibilityRepository;
  [PrimaryKeyProp]?: 'trip';
  trip?: Ref<Trips> | null;
  trip_id?: number | null;
  enabled_at?: string | null;
  enabled_by?: number | null;
  enabledByRef?: Ref<Users> | null;
}

export const TripPublicVisibilitySchema = defineEntity({
  class: TripPublicVisibility,
  repository: () => TripPublicVisibilityRepository,
  properties: {
    trip: () => p.oneToOne(Trips).primary().ref().deleteRule('cascade').nullable().hidden(),
    trip_id: p.integer().nullable().persist(false),
    enabled_at: p.type(DbTimestampType).nullable().defaultRaw(`CURRENT_TIMESTAMP`),
    enabled_by: p.integer().nullable().persist(false).index('idx_trip_public_visibility_enabled_by'),
    enabledByRef: () => p.manyToOne(Users).ref().joinColumn('enabled_by').deleteRule('no action').nullable().hidden().index('idx_trip_public_visibility_enabled_by'),
  },
});
