import { EntityRepositoryType, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { TripJoinRequestsRepository } from '../repositories/TripJoinRequests.repository';
import { DbTimestampType } from '../types';
import { Trips } from './Trips.entity';
import { Users } from './Users.entity';

export class TripJoinRequests {
  [EntityRepositoryType]?: TripJoinRequestsRepository;
  id!: number & Opt;
  trip!: Ref<Trips>;
  trip_id!: number;
  user!: Ref<Users>;
  user_id!: number;
  status: string & Opt = 'pending';
  created_at?: string | null;
  resolved_at?: string | null;
}

export const TripJoinRequestsSchema = defineEntity({
  class: TripJoinRequests,
  repository: () => TripJoinRequestsRepository,
  uniques: [{ properties: ['trip', 'user'] }],
  properties: {
    id: p.integer().primary(),
    trip: () => p.manyToOne(Trips).ref().deleteRule('cascade').hidden().index('idx_trip_join_requests_trip'),
    trip_id: p.integer().persist(false).index('idx_trip_join_requests_trip'),
    user: () => p.manyToOne(Users).ref().deleteRule('cascade').hidden().index('idx_trip_join_requests_user'),
    user_id: p.integer().persist(false).index('idx_trip_join_requests_user'),
    status: p.text().default('pending'),
    created_at: p.type(DbTimestampType).nullable().defaultRaw(`CURRENT_TIMESTAMP`),
    resolved_at: p.type(DbTimestampType).nullable(),
  },
});
