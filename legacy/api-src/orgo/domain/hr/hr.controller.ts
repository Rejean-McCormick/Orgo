// apps/api/src/orgo/domain/hr/hr.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Request } from 'express';

import {
  TaskSeverity,
  Visibility,
  TaskSource,
  HrCaseStatus,
  HrCaseParticipantRole,
} from './hr.service';
import { HrModuleService } from './hr.service';

/**
 * Multi‑tenant request context:
 * Organization + user id are injected by middleware.
 */
interface RequestWithContext extends Request {
  organizationId?: string;
  userId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Create HR case DTO                                                        */
/* -------------------------------------------------------------------------- */

export class RegisterHrCaseDto {
  @ApiProperty({
    description:
      'Canonical case label (e.g. "100.91.HR.Safety"). If omitted, the HR module will derive a domain‑appropriate default.',
    example: '100.91.HR.Safety',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiProperty({
    description: 'Short human‑readable title for the HR case.',
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  title!: string;

  @ApiProperty({
    description: 'Detailed description of the HR case.',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    description: 'Case severity (maps to TASK_SEVERITY). JSON uses lower‑case tokens.',
    enum: TaskSeverity,
    example: TaskSeverity.MODERATE,
    default: TaskSeverity.MODERATE,
  })
  @IsOptional()
  @IsEnum(TaskSeverity)
  severity?: TaskSeverity;

  @ApiPropertyOptional({
    description: 'Visibility level for the HR case.',
    enum: Visibility,
    example: Visibility.RESTRICTED,
    default: Visibility.RESTRICTED,
  })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({
    description: 'Source of the case: email, api, manual, sync.',
    enum: TaskSource,
    example: TaskSource.MANUAL,
    default: TaskSource.MANUAL,
  })
  @IsOptional()
  @IsEnum(TaskSource)
  source?: TaskSource;

  @ApiPropertyOptional({
    description: 'Primary person associated with the complaint (person_profiles.id).',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4')
  person_id?: string;

  @ApiPropertyOptional({
    description:
      'Optional HR metadata (must not duplicate core Task/Case fields).',
    type: 'object',
    nullable: true,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/*  HR Case Response DTO                                                      */
/* -------------------------------------------------------------------------- */

export class HrCaseResponseDto {
  @ApiProperty({ description: 'Canonical Case JSON structure' })
  case!: Record<string, unknown>;

  @ApiProperty({ description: 'HR‑specific HR case wrapper', type: 'object' })
  hr_case!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Primary participant, if any',
    nullable: true,
  })
  person_id?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  HR Case Listing DTO                                                       */
/* -------------------------------------------------------------------------- */

export class HrCaseListResponseDto {
  @ApiProperty({ type: [HrCaseResponseDto] })
  items!: HrCaseResponseDto[];

  @ApiProperty({
    description: 'Total number of matching HR cases.',
    example: 42,
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;
}

/* -------------------------------------------------------------------------- */
/*  Controller                                                                */
/* -------------------------------------------------------------------------- */

@ApiTags('domain-hr')
@ApiBearerAuth()
@Controller('domain/hr')
export class HrModuleController {
  constructor(private readonly hrService: HrModuleService) {}

  /* ----------------------------- Register case ---------------------------- */

  @Post('cases')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an HR case',
    description:
      'Creates a Case + HR Case wrapper according to HR domain rules.',
  })
  @ApiResponse({
    status: 201,
    type: HrCaseResponseDto,
  })
  async registerHrCase(
    @Req() req: RequestWithContext,
    @Body() payload: RegisterHrCaseDto,
  ): Promise<HrCaseResponseDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);
    const actorUserId = this.getUserIdFromRequest(req);

    return this.hrService.registerHrCase(organizationId, payload, actorUserId);
  }

  /* ----------------------------- List cases ------------------------------- */

  @Get('cases')
  @ApiOperation({
    summary: 'List HR cases for the current organization',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'page_size', required: false })
  @ApiResponse({
    status: 200,
    type: HrCaseListResponseDto,
  })
  async listHrCases(
    @Req() req: RequestWithContext,
    @Query('status') status?: HrCaseStatus,
    @Query('severity') severity?: TaskSeverity,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('page_size', new DefaultValuePipe(25), ParseIntPipe) pageSize = 25,
  ): Promise<HrCaseListResponseDto> {
    const organizationId = this.getOrganizationIdFromRequest(req);

    return this.hrService.listHrCases(organizationId, {
      status,
      severity,
      search,
      page,
      pageSize,
    });
  }

  /* ----------------------------- Helpers --------------------------------- */

  private getOrganizationIdFromRequest(req: RequestWithContext): string {
    const id = req.organizationId;
    if (!id) {
      throw new BadRequestException('Missing organization context on request.');
    }
    return id;
  }

  private getUserIdFromRequest(req: RequestWithContext): string | undefined {
    return req.userId;
  }
}
