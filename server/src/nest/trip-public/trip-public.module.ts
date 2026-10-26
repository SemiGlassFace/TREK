import { TripJoinRequests } from '../../db/entities/TripJoinRequests.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TripMembershipModule } from '../trip-membership/trip-membership.module';
import { TripPublicController } from './trip-public.controller';
import { TripPublicService } from './trip-public.service';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

/**
 * Publishing a trip read-only and the join requests that follow. A sink module,
 * like trip-members/: nothing imports it back, so it cannot close a cycle.
 * PermissionsModule is imported for TripOwnerGuard's provider graph.
 */
@Module({
  imports: [
    PermissionsModule,
    AuditModule,
    NotificationsModule,
    TripMembershipModule,
    MikroOrmModule.forFeature([TripJoinRequests]),
  ],
  controllers: [TripPublicController],
  providers: [TripPublicService],
  exports: [TripPublicService],
})
export class TripPublicModule {}
