import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../../types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireTripOwner, TripOwnerGuard } from '../permissions/trip-owner.guard';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { getClientIp } from '../audit/client-ip';
import { NotFoundError, ValidationError } from '../common/domain-errors';
import { TripVisibilityDto } from '../trips/trips.dto';
import { TripPublicService } from './trip-public.service';

/**
 * /api/trips/:id/{visibility,join-request,join-requests} — publishing a trip and
 * asking to join one.
 *
 * Same prefix as TripsController in a separate class, like trip-members/: every
 * route is a segment deeper than its `@Get(':id')`. Reading a public trip is not
 * here — that is TripAccessGuard's `@ViewerReadable()` on the itinerary routes.
 */
@Controller('api/trips')
@UseGuards(JwtAuthGuard)
export class TripPublicController {
  constructor(
    private readonly publicTrips: TripPublicService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Owner, member, or visitor of a published trip; anyone else sees a missing trip. */
  private requireVisible(id: string, user: User) {
    const access = this.db.canAccessTrip(id, user.id) ?? this.db.canViewPublicTrip(id);
    if (!access) throw new HttpException({ error: 'Trip not found' }, 404);
    return access;
  }

  // ── Visibility ──────────────────────────────────────────────────────────

  @Get(':id/visibility')
  getVisibility(@CurrentUser() user: User, @Param('id') id: string) {
    const access = this.requireVisible(id, user);
    return { is_public: this.publicTrips.isPublic(id), is_owner: access.user_id === user.id };
  }

  @Put(':id/visibility')
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the trip owner can change visibility', { param: 'id' })
  setVisibility(@CurrentUser() user: User, @Param('id') id: string, @Body() body: TripVisibilityDto, @Req() req: Request) {
    this.publicTrips.setPublic(id, body.is_public, user.id);
    this.audit.writeAudit({ userId: user.id, action: 'trip.visibility', ip: getClientIp(req), details: { tripId: Number(id), is_public: body.is_public } });
    return { is_public: body.is_public };
  }

  // ── The requester's side ────────────────────────────────────────────────

  @Get(':id/join-request')
  getJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    this.requireVisible(id, user);
    return { status: this.publicTrips.statusFor(id, user.id) };
  }

  @Post(':id/join-request')
  @HttpCode(200)
  submitJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    this.requireVisible(id, user);
    try {
      this.publicTrips.submit(id, user.id);
      return { status: 'pending' };
    } catch (e: unknown) {
      if (e instanceof NotFoundError) throw new HttpException({ error: e.message }, 404);
      if (e instanceof ValidationError) throw new HttpException({ error: e.message }, 400);
      throw e;
    }
  }

  @Delete(':id/join-request')
  cancelJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    this.requireVisible(id, user);
    if (!this.publicTrips.cancel(id, user.id)) throw new HttpException({ error: 'No pending join request' }, 404);
    return { success: true };
  }

  // ── The owner's side ────────────────────────────────────────────────────

  @Get(':id/join-requests')
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can view join requests', { param: 'id' })
  listJoinRequests(@Param('id') id: string) {
    return { requests: this.publicTrips.listPending(id) };
  }

  @Post(':id/join-requests/:requestId/accept')
  @HttpCode(200)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can manage join requests', { param: 'id' })
  accept(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.decide(id, requestId, 'accepted');
  }

  @Post(':id/join-requests/:requestId/reject')
  @HttpCode(200)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can manage join requests', { param: 'id' })
  reject(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.decide(id, requestId, 'rejected');
  }

  private decide(id: string, requestId: string, decision: 'accepted' | 'rejected') {
    try {
      const userId = this.publicTrips.resolveById(id, Number(requestId), decision);
      return { success: true, user_id: userId };
    } catch (e: unknown) {
      if (e instanceof NotFoundError) throw new HttpException({ error: e.message }, 404);
      throw e;
    }
  }
}
