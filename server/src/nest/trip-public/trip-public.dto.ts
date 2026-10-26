import { tripVisibilityRequestSchema } from '@trek/shared';

import { createZodDto } from 'nestjs-zod';

export class TripVisibilityDto extends createZodDto(tripVisibilityRequestSchema) {}
