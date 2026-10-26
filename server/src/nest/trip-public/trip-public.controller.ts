import type { User } from '../../types';
import { AuditService } from '../audit/audit.service';
import { getClientIp } from '../audit/client-ip';
import { CurrentUser } from '../auth-core/current-user.decorator';
import { JwtAuthGuard } from '../auth-core/jwt-auth.guard';
import { NotFoundError, ValidationError } from '../common/domain-errors';
import { ResponseContract } from '../common/response-contract';
import { toRowId } from '../common/row-id';
import { RequireTripOwner, TripOwnerGuard } from '../permissions/trip-owner.guard';
import { TripVisibilityDto } from './trip-public.dto';
import { TripPublicService } from './trip-public.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  tripJoinRequestCancelResponseSchema,
  tripJoinRequestDecisionResponseSchema,
  tripJoinRequestListResponseSchema,
  tripJoinRequestStatusResponseSchema,
  tripJoinRequestSubmitResponseSchema,
  tripVisibilityResponseSchema,
} from '@trek/shared';

import type { Request } from 'express';

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
    private readonly audit: AuditService,
  ) {}

  /** The route's trip id, parsed once; an unparseable one is a missing trip. */
  private tripId(id: string): number {
    const tripId = toRowId(id);
    if (tripId === null) throw new HttpException({ error: 'Trip not found' }, 404);
    return tripId;
  }

  /** Owner, member, or visitor of a published trip; anyone else sees a missing trip. */
  private async requireVisible(id: string, user: User) {
    const tripId = this.tripId(id);
    const access = await this.publicTrips.findVisible(tripId, user.id);
    if (!access) throw new HttpException({ error: 'Trip not found' }, 404);
    return { tripId, access };
  }

  // ── Visibility ──────────────────────────────────────────────────────────

  @Get(':id/visibility')
  @ResponseContract(tripVisibilityResponseSchema)
  async getVisibility(@CurrentUser() user: User, @Param('id') id: string) {
    const { tripId, access } = await this.requireVisible(id, user);
    return { is_public: await this.publicTrips.isPublic(tripId), is_owner: access.user_id === user.id };
  }

  @Put(':id/visibility')
  @ResponseContract(tripVisibilityResponseSchema)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the trip owner can change visibility', { param: 'id' })
  async setVisibility(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: TripVisibilityDto,
    @Req() req: Request,
  ) {
    const tripId = this.tripId(id);
    await this.publicTrips.setPublic(tripId, body.is_public, user.id);
    await this.audit.writeAudit({
      userId: user.id,
      action: 'trip.visibility',
      ip: getClientIp(req),
      details: { tripId, is_public: body.is_public },
    });
    return { is_public: body.is_public };
  }

  // ── The requester's side ────────────────────────────────────────────────

  @Get(':id/join-request')
  @ResponseContract(tripJoinRequestStatusResponseSchema)
  async getJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    const { tripId } = await this.requireVisible(id, user);
    return { status: await this.publicTrips.statusFor(tripId, user.id) };
  }

  @Post(':id/join-request')
  @ResponseContract(tripJoinRequestSubmitResponseSchema)
  @HttpCode(200)
  async submitJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    const { tripId } = await this.requireVisible(id, user);
    try {
      await this.publicTrips.submit(tripId, user.id);
      return { status: 'pending' };
    } catch (e: unknown) {
      if (e instanceof NotFoundError) throw new HttpException({ error: e.message }, 404);
      if (e instanceof ValidationError) throw new HttpException({ error: e.message }, 400);
      throw e;
    }
  }

  @Delete(':id/join-request')
  @ResponseContract(tripJoinRequestCancelResponseSchema)
  async cancelJoinRequest(@CurrentUser() user: User, @Param('id') id: string) {
    const { tripId } = await this.requireVisible(id, user);
    if (!(await this.publicTrips.cancel(tripId, user.id))) {
      throw new HttpException({ error: 'No pending join request' }, 404);
    }
    return { success: true };
  }

  // ── The owner's side ────────────────────────────────────────────────────

  @Get(':id/join-requests')
  @ResponseContract(tripJoinRequestListResponseSchema)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can view join requests', { param: 'id' })
  async listJoinRequests(@Param('id') id: string) {
    return { requests: await this.publicTrips.listPending(this.tripId(id)) };
  }

  @Post(':id/join-requests/:requestId/accept')
  @ResponseContract(tripJoinRequestDecisionResponseSchema)
  @HttpCode(200)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can manage join requests', { param: 'id' })
  accept(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.decide(id, requestId, 'accepted');
  }

  @Post(':id/join-requests/:requestId/reject')
  @ResponseContract(tripJoinRequestDecisionResponseSchema)
  @HttpCode(200)
  @UseGuards(TripOwnerGuard)
  @RequireTripOwner('Only the owner can manage join requests', { param: 'id' })
  reject(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.decide(id, requestId, 'rejected');
  }

  private async decide(id: string, requestId: string, decision: 'accepted' | 'rejected') {
    try {
      const userId = await this.publicTrips.resolveById(this.tripId(id), Number(requestId), decision);
      return { success: true, user_id: userId };
    } catch (e: unknown) {
      if (e instanceof NotFoundError) throw new HttpException({ error: e.message }, 404);
      throw e;
    }
  }
}
