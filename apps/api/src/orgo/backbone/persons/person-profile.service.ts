import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PersonProfile } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { FN_BACKBONE_PERSON_UPSERT } from '../../core/functional-ids';

export type ConfidentialityLevel = 'normal' | 'sensitive' | 'highly_sensitive';

export interface UpsertPersonProfileInput {
  /**
   * Tenant isolation key – required for all operations.
   */
  organizationId: string;

  /**
   * Optional person ID:
   * - If provided → update this record (after org check).
   * - If omitted → create a new record or reuse by (org, externalReference) if present.
   */
  personId?: string;

  /**
   * Optional link to a user account in the same org.
   * Can be null to explicitly clear the link.
   */
  linkedUserId?: string | null;

  /**
   * Optional external reference (student ID, employee number, etc.).
   * Used as a secondary key for “upsert by external id” when personId is not provided.
   */
  externalReference?: string | null;

  /**
   * Canonical full name for analytics (insights.dim_persons.full_name).
   */
  fullName: string;

  /**
   * Date of birth (ISO date string or Date). Nullable.
   */
  dateOfBirth?: string | Date | null;

  /**
   * Primary contact email. Nullable.
   */
  primaryContactEmail?: string | null;

  /**
   * Primary contact phone. Nullable.
   */
  primaryContactPhone?: string | null;

  /**
   * Confidentiality level, drives visibility/guardrails.
   * Defaults to "normal" when omitted.
   */
  confidentialityLevel?: ConfidentialityLevel;
}

@Injectable()
export class PersonProfileService {
  private readonly logger = new Logger(PersonProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or update a person profile within an organization.
   *
   * Resolution order:
   * 1. If personId is provided → update that record (after verifying organizationId).
   * 2. Else if externalReference is provided → try to find (organizationId, externalReference) and update it.
   * 3. Else → create a new person profile.
   */
  async upsertPersonProfile(input: UpsertPersonProfileInput): Promise<PersonProfile> {
    const { organizationId } = input;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required.');
    }

    if (!input.fullName || !input.fullName.trim()) {
      throw new BadRequestException('fullName is required.');
    }

    const confidentialityLevel: ConfidentialityLevel =
      input.confidentialityLevel ?? 'normal';

    if (!this.isValidConfidentialityLevel(confidentialityLevel)) {
      throw new BadRequestException(
        `Invalid confidentialityLevel "${confidentialityLevel}". Expected one of "normal" | "sensitive" | "highly_sensitive".`,
      );
    }

    const dateOfBirth = this.parseDateOfBirth(input.dateOfBirth);

    const basePayload = {
      organizationId,
      linkedUserId:
        typeof input.linkedUserId === 'undefined' ? undefined : input.linkedUserId,
      externalReference:
        typeof input.externalReference === 'undefined'
          ? undefined
          : input.externalReference,
      fullName: input.fullName.trim(),
      dateOfBirth,
      primaryContactEmail:
        typeof input.primaryContactEmail === 'undefined'
          ? undefined
          : input.primaryContactEmail,
      primaryContactPhone:
        typeof input.primaryContactPhone === 'undefined'
          ? undefined
          : input.primaryContactPhone,
      confidentialityLevel,
    };

    let targetId = input.personId;

    // If no explicit ID, try to resolve by (organizationId, externalReference)
    if (!targetId && input.externalReference) {
      const existingByExternal = await this.prisma.personProfile.findFirst({
        where: {
          organizationId,
          externalReference: input.externalReference,
        },
      });

      if (existingByExternal) {
        targetId = existingByExternal.id;
      }
    }

    // Update existing record
    if (targetId) {
      const existing = await this.prisma.personProfile.findUnique({
        where: { id: targetId },
      });

      if (!existing || existing.organizationId !== organizationId) {
        throw new NotFoundException(
          'PersonProfile not found for the specified organization.',
        );
      }

      this.logger.debug(
        `Updating person profile ${targetId} for org ${organizationId} [${FN_BACKBONE_PERSON_UPSERT}]`,
      );

      const updateData: Prisma.PersonProfileUpdateInput = {
        // Never allow cross-tenant moves – enforce same org id
        organizationId: existing.organizationId,
        ...this.buildUpdatePayload(basePayload),
      };

      return this.prisma.personProfile.update({
        where: { id: targetId },
        data: updateData,
      });
    }

    // Create new record
    this.logger.debug(
      `Creating person profile for org ${organizationId} (external_reference=${input.externalReference ?? 'null'}) [${FN_BACKBONE_PERSON_UPSERT}]`,
    );

    const createData: Prisma.PersonProfileCreateInput = {
      ...this.buildCreatePayload(basePayload),
    };

    return this.prisma.personProfile.create({
      data: createData,
    });
  }

  /**
   * Fetch a single person profile by ID within an organization.
   * Enforces multi-tenant isolation via organizationId.
   */
  async getPersonProfileById(
    organizationId: string,
    personId: string,
  ): Promise<PersonProfile> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required.');
    }

    if (!personId) {
      throw new BadRequestException('personId is required.');
    }

    const profile = await this.prisma.personProfile.findFirst({
      where: { id: personId, organizationId },
    });

    if (!profile) {
      throw new NotFoundException('PersonProfile not found.');
    }

    return profile;
  }

  /**
   * Fetch a person profile by (organizationId, externalReference).
   * Returns null when no match is found.
   */
  async findPersonProfileByExternalReference(
    organizationId: string,
    externalReference: string,
  ): Promise<PersonProfile | null> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required.');
    }

    if (!externalReference) {
      throw new BadRequestException('externalReference is required.');
    }

    return this.prisma.personProfile.findFirst({
      where: { organizationId, externalReference },
    });
  }

  /**
   * Lightweight search over person profiles within an organization.
   * - query matches full_name, primary_contact_email, primary_contact_phone (case-insensitive).
   * - externalReference filter optionally narrows the search.
   */
  async searchPersonProfiles(params: {
    organizationId: string;
    query?: string;
    externalReference?: string;
    limit?: number;
  }): Promise<PersonProfile[]> {
    const { organizationId, query, externalReference, limit = 25 } = params;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required.');
    }

    const where: Prisma.PersonProfileWhereInput = {
      organizationId,
    };

    if (externalReference) {
      where.externalReference = {
        contains: externalReference,
        mode: 'insensitive',
      };
    }

    if (query && query.trim().length > 0) {
      const q = query.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { primaryContactEmail: { contains: q, mode: 'insensitive' } },
        { primaryContactPhone: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.personProfile.findMany({
      where,
      take: limit,
      orderBy: { fullName: 'asc' },
    });
  }

  private isValidConfidentialityLevel(
    level: string,
  ): level is ConfidentialityLevel {
    return level === 'normal' || level === 'sensitive' || level === 'highly_sensitive';
  }

  private parseDateOfBirth(
    value: string | Date | null | undefined,
  ): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new BadRequestException('dateOfBirth is invalid.');
      }
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('dateOfBirth must be a valid ISO date string.');
    }

    return parsed;
  }

  /**
   * Build payload for create operations.
   * Explicitly sets nullable fields to null when not provided.
   */
  private buildCreatePayload(base: {
    organizationId: string;
    linkedUserId?: string | null;
    externalReference?: string | null;
    fullName: string;
    dateOfBirth: Date | null;
    primaryContactEmail?: string | null;
    primaryContactPhone?: string | null;
    confidentialityLevel: ConfidentialityLevel;
  }): Prisma.PersonProfileCreateInput {
    return {
      organizationId: base.organizationId,
      linkedUserId: base.linkedUserId ?? null,
      externalReference: base.externalReference ?? null,
      fullName: base.fullName,
      dateOfBirth: base.dateOfBirth,
      primaryContactEmail: base.primaryContactEmail ?? null,
      primaryContactPhone: base.primaryContactPhone ?? null,
      confidentialityLevel: base.confidentialityLevel,
    };
  }

  /**
   * Build payload for update operations.
   * Uses the same semantics as create (fields not supplied are cleared to null),
   * but does not attempt to change organizationId.
   */
  private buildUpdatePayload(base: {
    organizationId: string;
    linkedUserId?: string | null;
    externalReference?: string | null;
    fullName: string;
    dateOfBirth: Date | null;
    primaryContactEmail?: string | null;
    primaryContactPhone?: string | null;
    confidentialityLevel: ConfidentialityLevel;
  }): Prisma.PersonProfileUpdateInput {
    const data: Prisma.PersonProfileUpdateInput = {
      fullName: base.fullName,
      dateOfBirth: base.dateOfBirth,
      confidentialityLevel: base.confidentialityLevel,
    };

    if (typeof base.linkedUserId !== 'undefined') {
      data.linkedUserId = base.linkedUserId;
    }

    if (typeof base.externalReference !== 'undefined') {
      data.externalReference = base.externalReference;
    }

    if (typeof base.primaryContactEmail !== 'undefined') {
      data.primaryContactEmail = base.primaryContactEmail;
    }

    if (typeof base.primaryContactPhone !== 'undefined') {
      data.primaryContactPhone = base.primaryContactPhone;
    }

    return data;
  }
}
