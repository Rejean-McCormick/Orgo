// apps/api/src/orgo/backbone/organizations/organization.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { LogService } from '../../core/logging/log.service';

export type OrganizationStatus = 'active' | 'suspended' | 'archived';

export interface CreateOrganizationInput {
  slug?: string;
  displayName: string;
  legalName?: string | null;
  primaryDomain?: string | null;
  timezone: string;
  defaultLocale: string;
  /**
   * Profile code from profiles YAML (e.g. "default", "hospital", "advocacy_group").
   * If omitted, defaults to "default".
   */
  profileCode?: string;
  status?: OrganizationStatus;
}

export interface UpdateOrganizationInput {
  slug?: string;
  displayName?: string;
  legalName?: string | null;
  primaryDomain?: string | null;
  timezone?: string;
  defaultLocale?: string;
  /**
   * New profile code to attach to this org. If omitted, existing profile is kept.
   * If explicitly set to null, existing profile is left unchanged (no delete here).
   */
  profileCode?: string | null;
  status?: OrganizationStatus;
}

/**
 * Canonical TS view of an Organization row with its linked profile_code.
 * Maps directly from the `organizations` and `organization_profiles` tables. 
 */
export interface OrganizationWithProfile {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  primaryDomain: string | null;
  status: OrganizationStatus;
  timezone: string;
  defaultLocale: string;
  profileCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Internal shape that matches the DB row names (`snake_case`) plus optional `profile_code`
 * when joined with `organization_profiles`. 
 */
interface DbOrganizationRow {
  id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  primary_domain: string | null;
  status: OrganizationStatus;
  timezone: string;
  default_locale: string;
  created_at: Date;
  updated_at: Date;
  profile_code?: string | null;
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  private static readonly ALLOWED_STATUSES: OrganizationStatus[] = [
    'active',
    'suspended',
    'archived',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly logService: LogService,
  ) {}

  /**
   * Create a new organization (tenant) and attach a single active profile row. 
   */
  async createOrganization(
    input: CreateOrganizationInput,
  ): Promise<OrganizationWithProfile> {
    const displayName = input.displayName?.trim();
    if (!displayName) {
      throw new BadRequestException('displayName is required');
    }

    const timezone = input.timezone?.trim();
    if (!timezone) {
      throw new BadRequestException('timezone is required');
    }

    const defaultLocale = input.defaultLocale?.trim();
    if (!defaultLocale) {
      throw new BadRequestException('defaultLocale is required');
    }

    const slug = this.normalizeSlug(input.slug ?? displayName);
    if (!slug) {
      throw new BadRequestException('Organization slug cannot be empty');
    }

    const status: OrganizationStatus = input.status ?? 'active';
    this.ensureValidStatus(status);

    const profileCode = input.profileCode ?? 'default';

    const organization = await this.prisma.$transaction<OrganizationWithProfile>(
      async (tx) => {
        // Enforce unique slug
        const existing = await tx.$queryRaw<Pick<DbOrganizationRow, 'id'>[]>`
          SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1
        `;
        if (existing.length > 0) {
          throw new ConflictException(
            `Organization slug "${slug}" is already in use`,
          );
        }

        const orgId = randomUUID();
        const profileId = randomUUID();

        const [inserted] = await tx.$queryRaw<DbOrganizationRow[]>`
          INSERT INTO organizations (
            id,
            slug,
            display_name,
            legal_name,
            primary_domain,
            status,
            timezone,
            default_locale
          )
          VALUES (
            ${orgId},
            ${slug},
            ${displayName},
            ${input.legalName ?? null},
            ${input.primaryDomain ?? null},
            ${status},
            ${timezone},
            ${defaultLocale}
          )
          RETURNING
            id,
            slug,
            display_name,
            legal_name,
            primary_domain,
            status,
            timezone,
            default_locale,
            created_at,
            updated_at
        `;

        // Create a single profile row for this org (one active profile per org). :contentReference[oaicite:3]{index=3}
        await tx.$queryRaw`
          INSERT INTO organization_profiles (
            id,
            organization_id,
            profile_code,
            reactivity_profile,
            transparency_profile,
            pattern_sensitivity_profile,
            retention_profile,
            version
          )
          VALUES (
            ${profileId},
            ${orgId},
            ${profileCode},
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            1
          )
        `;

        return this.mapOrganizationRow({
          ...inserted,
          profile_code: profileCode,
        });
      },
    );

    this.logService.logEvent({
      category: 'SYSTEM',
      logLevel: 'INFO',
      message: 'Organization created',
      identifier: `organization_id:${organization.id}`,
      metadata: {
        slug: organization.slug,
        profileCode: organization.profileCode,
      },
    });

    this.logger.log(`Created organization "${organization.slug}"`);

    return organization;
  }

  /**
   * Update an existing organization and optionally its attached profile_code. :contentReference[oaicite:4]{index=4}
   */
  async updateOrganization(
    id: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationWithProfile> {
    if (!id) {
      throw new BadRequestException('id is required');
    }

    const organization = await this.prisma.$transaction<OrganizationWithProfile>(
      async (tx) => {
        const rows = await tx.$queryRaw<DbOrganizationRow[]>`
          SELECT
            o.id,
            o.slug,
            o.display_name,
            o.legal_name,
            o.primary_domain,
            o.status,
            o.timezone,
            o.default_locale,
            o.created_at,
            o.updated_at,
            op.profile_code
          FROM organizations o
          LEFT JOIN organization_profiles op
            ON op.organization_id = o.id
          WHERE o.id = ${id}
          LIMIT 1
        `;

        if (rows.length === 0) {
          throw new NotFoundException(
            `Organization with id "${id}" not found`,
          );
        }

        const current = rows[0];

        const newSlug =
          input.slug !== undefined
            ? this.normalizeSlug(input.slug)
            : current.slug;

        if (!newSlug) {
          throw new BadRequestException('Organization slug cannot be empty');
        }

        let newStatus: OrganizationStatus = current.status;
        if (input.status) {
          this.ensureValidStatus(input.status);
          newStatus = input.status;
        }

        const newDisplayName =
          input.displayName?.trim() || current.display_name;
        const newLegalName =
          input.legalName !== undefined ? input.legalName : current.legal_name;
        const newPrimaryDomain =
          input.primaryDomain !== undefined
            ? input.primaryDomain
            : current.primary_domain;
        const newTimezone =
          input.timezone?.trim() || current.timezone;
        const newDefaultLocale =
          input.defaultLocale?.trim() || current.default_locale;

        const newProfileCode =
          input.profileCode !== undefined
            ? input.profileCode
            : current.profile_code ?? null;

        // If slug changed, ensure it remains unique
        if (newSlug !== current.slug) {
          const existingSlug = await tx.$queryRaw<
            Pick<DbOrganizationRow, 'id'>[]
          >`
            SELECT id
            FROM organizations
            WHERE slug = ${newSlug}
              AND id <> ${id}
            LIMIT 1
          `;
          if (existingSlug.length > 0) {
            throw new ConflictException(
              `Organization slug "${newSlug}" is already in use`,
            );
          }
        }

        const [updated] = await tx.$queryRaw<DbOrganizationRow[]>`
          UPDATE organizations
          SET
            slug = ${newSlug},
            display_name = ${newDisplayName},
            legal_name = ${newLegalName},
            primary_domain = ${newPrimaryDomain},
            status = ${newStatus},
            timezone = ${newTimezone},
            default_locale = ${newDefaultLocale},
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING
            id,
            slug,
            display_name,
            legal_name,
            primary_domain,
            status,
            timezone,
            default_locale,
            created_at,
            updated_at
        `;

        if (newProfileCode) {
          // Upsert the org's profile row; enforce single profile per org. :contentReference[oaicite:5]{index=5}
          const existingProfile = await tx.$queryRaw<{ id: string }[]>`
            SELECT id
            FROM organization_profiles
            WHERE organization_id = ${id}
            LIMIT 1
          `;

          if (existingProfile.length === 0) {
            const profileId = randomUUID();
            await tx.$queryRaw`
              INSERT INTO organization_profiles (
                id,
                organization_id,
                profile_code,
                reactivity_profile,
                transparency_profile,
                pattern_sensitivity_profile,
                retention_profile,
                version
              )
              VALUES (
                ${profileId},
                ${id},
                ${newProfileCode},
                '{}'::jsonb,
                '{}'::jsonb,
                '{}'::jsonb,
                '{}'::jsonb,
                1
              )
            `;
          } else {
            await tx.$queryRaw`
              UPDATE organization_profiles
              SET
                profile_code = ${newProfileCode},
                version = version + 1,
                updated_at = NOW()
              WHERE organization_id = ${id}
            `;
          }
        }

        return this.mapOrganizationRow({
          ...updated,
          profile_code: newProfileCode ?? current.profile_code ?? null,
        });
      },
    );

    this.logService.logEvent({
      category: 'SYSTEM',
      logLevel: 'INFO',
      message: 'Organization updated',
      identifier: `organization_id:${organization.id}`,
      metadata: {
        slug: organization.slug,
        profileCode: organization.profileCode,
      },
    });

    this.logger.log(`Updated organization "${organization.slug}"`);

    return organization;
  }

  /**
   * Fetch a single organization by id, including its profile_code.
   */
  async getOrganizationById(id: string): Promise<OrganizationWithProfile> {
    if (!id) {
      throw new BadRequestException('id is required');
    }

    const rows = await this.prisma.$queryRaw<DbOrganizationRow[]>`
      SELECT
        o.id,
        o.slug,
        o.display_name,
        o.legal_name,
        o.primary_domain,
        o.status,
        o.timezone,
        o.default_locale,
        o.created_at,
        o.updated_at,
        op.profile_code
      FROM organizations o
      LEFT JOIN organization_profiles op
        ON op.organization_id = o.id
      WHERE o.id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new NotFoundException(`Organization with id "${id}" not found`);
    }

    return this.mapOrganizationRow(rows[0]);
  }

  /**
   * Fetch a single organization by slug, including its profile_code.
   */
  async getOrganizationBySlug(
    slug: string,
  ): Promise<OrganizationWithProfile> {
    const normalizedSlug = this.normalizeSlug(slug);
    if (!normalizedSlug) {
      throw new BadRequestException('slug cannot be empty');
    }

    const rows = await this.prisma.$queryRaw<DbOrganizationRow[]>`
      SELECT
        o.id,
        o.slug,
        o.display_name,
        o.legal_name,
        o.primary_domain,
        o.status,
        o.timezone,
        o.default_locale,
        o.created_at,
        o.updated_at,
        op.profile_code
      FROM organizations o
      LEFT JOIN organization_profiles op
        ON op.organization_id = o.id
      WHERE o.slug = ${normalizedSlug}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new NotFoundException(
        `Organization with slug "${normalizedSlug}" not found`,
      );
    }

    return this.mapOrganizationRow(rows[0]);
  }

  /**
   * List all organizations with their attached profile_code, ordered by display_name.
   */
  async listOrganizations(): Promise<OrganizationWithProfile[]> {
    const rows = await this.prisma.$queryRaw<DbOrganizationRow[]>`
      SELECT
        o.id,
        o.slug,
        o.display_name,
        o.legal_name,
        o.primary_domain,
        o.status,
        o.timezone,
        o.default_locale,
        o.created_at,
        o.updated_at,
        op.profile_code
      FROM organizations o
      LEFT JOIN organization_profiles op
        ON op.organization_id = o.id
      ORDER BY o.display_name ASC
    `;

    return rows.map((row) => this.mapOrganizationRow(row));
  }

  /**
   * Ensure the status value is within `organization_status_enum`. :contentReference[oaicite:6]{index=6}
   */
  private ensureValidStatus(status: OrganizationStatus): void {
    if (!OrganizationService.ALLOWED_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Invalid organization status "${status}" (expected one of: ${OrganizationService.ALLOWED_STATUSES.join(
          ', ',
        )})`,
      );
    }
  }

  /**
   * Normalize a human-entered slug or name into a stable org slug:
   * - lower-case
   * - non-alphanumeric → "-"
   * - trim leading/trailing "-"
   * - max length 63 chars (DNS-ish). :contentReference[oaicite:7]{index=7}
   */
  private normalizeSlug(source: string): string {
    return source
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  }

  /**
   * Map a DB row (snake_case) into the canonical TS view (camelCase + profileCode).
   */
  private mapOrganizationRow(row: DbOrganizationRow): OrganizationWithProfile {
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      legalName: row.legal_name,
      primaryDomain: row.primary_domain,
      status: row.status,
      timezone: row.timezone,
      defaultLocale: row.default_locale,
      profileCode: row.profile_code ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
