import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TripPublicController } from './trip-public.controller';
import { TripPublicService } from './trip-public.service';

/**
 * Publishing a trip read-only and the join requests that follow. A sink module,
 * like trip-members/: nothing imports it back, so it cannot close a cycle.
 * PermissionsModule is imported for TripOwnerGuard's provider graph.
 */
@Module({
  imports: [DatabaseModule, PermissionsModule, AuditModule, NotificationsModule],
  controllers: [TripPublicController],
  providers: [TripPublicService],
  exports: [TripPublicService],
})
export class TripPublicModule {}
