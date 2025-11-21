import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { SignalIngestService } from './signal-ingest.service';

/**
 * Canonical signal source values, aligned with task_source_enum:
 * 'email' | 'api' | 'manual' | 'sync'.
 */
export enum SignalSource {
  EMAIL = 'email',
  API = 'api',
  MANUAL = 'manual',
  SYNC = 'sync',
}

/**
 * DTO for ingesting a generic "signal" into Orgo.
 *
 * A signal is a normalized input that Core Services can route into
 * Tasks and/or Cases via the workflow engine. It is intentionally
 * flexible while still enforcing core invariants:
 *
 * - organization_id is always required (multi‑tenant key).
 * - source maps to the canonical task_source_enum.
 * - type may hint at the target Task.type (maintenance, hr_case, etc.).
 * - title/description are optional summaries for human‑readable context.
 * - label can carry a canonical information label if already known.
 * - created_by_user_id / requester_person_id link the signal to actors.
 * - payload carries any additional, domain‑specific JSON.
 */
export class CreateSignalDto {
  @IsUUID()
  organization_id!: string;

  @IsEnum(SignalSource)
  source!: SignalSource;

  /**
   * Optional domain type hint, e.g. "maintenance", "hr_case",
   * "education_support", "generic". This is expected to map to Task.type.
   */
  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  title?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  description?: string;

  /**
   * Optional canonical information label:
   * "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"
   * (see Doc 2/8 label semantics).
   */
  @IsString()
  @IsOptional()
  label?: string;

  /**
   * Optional linkage to the Orgo user that is submitting the signal.
   * In many deployments this will be derived from auth context instead
   * of being sent explicitly; this field exists for explicit overrides
   * and non‑user API clients.
   */
  @IsUUID()
  @IsOptional()
  created_by_user_id?: string;

  /**
   * Optional linkage to the Person the signal is about (student, employee,
   * player, community member, etc.).
   */
  @IsUUID()
  @IsOptional()
  requester_person_id?: string;

  /**
   * Optional arbitrary JSON payload carrying domain‑specific content
   * (form fields, structured metadata, attachments references, etc.).
   * Core Services and domain handlers are responsible for interpreting
   * this payload and mapping it into Task/Case metadata.
   */
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}

/**
 * SignalController
 *
 * HTTP entrypoint for ingesting generic signals (non‑email) into Orgo.
 * Typical route: POST /api/v3/signals
 *
 * This controller is intentionally thin: it validates the incoming DTO
 * and delegates to SignalIngestService.ingest, which implements the
 * standard result shape { ok, data, error } and is responsible for
 * mapping the signal into Tasks/Cases via the workflow engine.
 */
@Controller('signals')
export class SignalController {
  constructor(private readonly signalIngestService: SignalIngestService) {}

  /**
   * Ingest a new signal.
   *
   * The service is expected to:
   * - normalise the signal into the internal representation,
   * - invoke the workflow engine,
   * - create any resulting Tasks/Cases,
   * - and return a standard result shape.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async createSignal(@Body() dto: CreateSignalDto): Promise<any> {
    return this.signalIngestService.ingest(dto);
  }
}
