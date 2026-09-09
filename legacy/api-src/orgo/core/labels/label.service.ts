import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, LabelDefinition, EntityLabel } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

export interface CreateLabelDefinitionInput {
  /**
   * Owning organization. Omit or set to null for a global label.
   */
  organizationId?: string | null;
  /**
   * Stable machine-readable code, unique per org/global.
   * Examples: "self_harm_risk", "equipment_failure".
   */
  code: string;
  /**
   * Human-friendly name for the label.
   */
  displayName: string;
  /**
   * Description for admins / reviewers.
   */
  description: string;
  /**
   * High-level classification bucket.
   * Examples: "risk", "topic", "visibility".
   */
  category: string;
  /**
   * Optional color hint for UI (hex or named color).
   */
  colorHint?: string | null;
}

export interface UpdateLabelDefinitionInput {
  displayName?: string;
  description?: string;
  category?: string;
  colorHint?: string | null;
}

export interface AssignLabelToEntityInput {
  /**
   * Organization that owns the entity (tenant).
   */
  organizationId: string;
  /**
   * Classification label code; resolved against org + global definitions.
   */
  labelCode: string;
  /**
   * Target entity type (e.g. "task", "person", "learning_group", "case").
   */
  entityType: string;
  /**
   * Target entity id (UUID from the corresponding table).
   */
  entityId: string;
  /**
   * Optional user who applied the label.
   */
  appliedByUserId?: string | null;
}

export interface RemoveLabelFromEntityInput {
  organizationId: string;
  labelCode: string;
  entityType: string;
  entityId: string;
}

export type EntityLabelWithDefinition = EntityLabel & {
  label: LabelDefinition;
};

/**
 * LabelService
 *
 * Manages classification label definitions (`label_definitions`) and their
 * attachments to entities (`entity_labels`), separate from the single canonical
 * information label stored on Tasks/Cases.
 */
@Injectable()
export class LabelService {
  private readonly prisma: PrismaClient;

  constructor(private readonly prismaService: PrismaService) {
    this.prisma = prismaService;
  }

  /**
   * Create a new LabelDefinition for an org or globally.
   * Enforces uniqueness of (organizationId, code).
   */
  async createLabelDefinition(
    input: CreateLabelDefinitionInput,
  ): Promise<LabelDefinition> {
    const organizationId = input.organizationId ?? null;

    if (!input.code?.trim()) {
      throw new BadRequestException('Label code must be a non-empty string.');
    }
    if (!input.displayName?.trim()) {
      throw new BadRequestException('Label displayName must be a non-empty string.');
    }
    if (!input.description?.trim()) {
      throw new BadRequestException('Label description must be a non-empty string.');
    }
    if (!input.category?.trim()) {
      throw new BadRequestException('Label category must be a non-empty string.');
    }

    const existing = await this.prisma.labelDefinition.findFirst({
      where: {
        code: input.code,
        organizationId,
      },
    });

    if (existing) {
      throw new ConflictException(
        `LabelDefinition with code "${input.code}" already exists for this scope.`,
      );
    }

    try {
      return await this.prisma.labelDefinition.create({
        data: {
          organizationId,
          code: input.code,
          displayName: input.displayName,
          description: input.description,
          category: input.category,
          colorHint: input.colorHint ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Unique constraint violation (e.g. on organizationId + code)
        throw new ConflictException(
          `LabelDefinition with code "${input.code}" already exists.`,
        );
      }
      throw error;
    }
  }

  /**
   * Update an existing LabelDefinition by id, scoped to an org (or global).
   */
  async updateLabelDefinition(
    id: string,
    organizationId: string | null,
    updates: UpdateLabelDefinitionInput,
  ): Promise<LabelDefinition> {
    const normalizedOrgId = organizationId ?? null;

    const label = await this.prisma.labelDefinition.findFirst({
      where: { id, organizationId: normalizedOrgId },
    });

    if (!label) {
      throw new NotFoundException(
        `LabelDefinition "${id}" not found for the specified organization scope.`,
      );
    }

    if (
      updates.displayName !== undefined &&
      !updates.displayName.trim()
    ) {
      throw new BadRequestException('displayName, if provided, must be non-empty.');
    }
    if (
      updates.description !== undefined &&
      !updates.description.trim()
    ) {
      throw new BadRequestException('description, if provided, must be non-empty.');
    }
    if (
      updates.category !== undefined &&
      !updates.category.trim()
    ) {
      throw new BadRequestException('category, if provided, must be non-empty.');
    }

    return this.prisma.labelDefinition.update({
      where: { id: label.id },
      data: {
        displayName: updates.displayName ?? label.displayName,
        description: updates.description ?? label.description,
        category: updates.category ?? label.category,
        colorHint:
          updates.colorHint !== undefined ? updates.colorHint : label.colorHint,
      },
    });
  }

  /**
   * Delete a LabelDefinition by id, scoped to an org (or global).
   *
   * Note: DB-level foreign keys decide whether delete cascades or fails if
   * EntityLabels still reference this label.
   */
  async deleteLabelDefinition(
    id: string,
    organizationId: string | null,
  ): Promise<void> {
    const normalizedOrgId = organizationId ?? null;

    const label = await this.prisma.labelDefinition.findFirst({
      where: { id, organizationId: normalizedOrgId },
    });

    if (!label) {
      throw new NotFoundException(
        `LabelDefinition "${id}" not found for the specified organization scope.`,
      );
    }

    await this.prisma.labelDefinition.delete({
      where: { id: label.id },
    });
  }

  /**
   * Return LabelDefinitions visible to an org:
   *   - Global labels (organizationId = null)
   *   - Org-specific labels (organizationId = <org>)
   * If the same code exists in both scopes, the org-specific one wins.
   */
  async getLabelDefinitionsForOrg(
    organizationId: string,
  ): Promise<LabelDefinition[]> {
    const [globalLabels, orgLabels] = await Promise.all([
      this.prisma.labelDefinition.findMany({
        where: { organizationId: null },
      }),
      this.prisma.labelDefinition.findMany({
        where: { organizationId },
      }),
    ]);

    const byCode = new Map<string, LabelDefinition>();

    for (const label of globalLabels) {
      byCode.set(label.code, label);
    }
    for (const label of orgLabels) {
      // Org-specific overrides global
      byCode.set(label.code, label);
    }

    return Array.from(byCode.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    );
  }

  /**
   * Resolve a LabelDefinition by code for a given org, with fallback to global.
   * Org-specific definitions override global ones when codes clash.
   */
  async getLabelDefinitionByCode(
    organizationId: string,
    code: string,
  ): Promise<LabelDefinition> {
    if (!code?.trim()) {
      throw new BadRequestException('Label code must be a non-empty string.');
    }

    const [orgSpecific, global] = await Promise.all([
      this.prisma.labelDefinition.findFirst({
        where: {
          organizationId,
          code,
        },
      }),
      this.prisma.labelDefinition.findFirst({
        where: {
          organizationId: null,
          code,
        },
      }),
    ]);

    const label = orgSpecific ?? global;

    if (!label) {
      throw new NotFoundException(
        `LabelDefinition with code "${code}" not found for organization or global scope.`,
      );
    }

    return label;
  }

  /**
   * Attach a classification label (by code) to an entity.
   * Respects org + global label definitions.
   */
  async assignLabelToEntity(
    input: AssignLabelToEntityInput,
  ): Promise<EntityLabel> {
    if (!input.entityType?.trim()) {
      throw new BadRequestException('entityType must be a non-empty string.');
    }
    if (!input.entityId?.trim()) {
      throw new BadRequestException('entityId must be a non-empty string.');
    }

    const label = await this.getLabelDefinitionByCode(
      input.organizationId,
      input.labelCode,
    );

    // Avoid duplicate attachments for the same (org, entity, label)
    const existing = await this.prisma.entityLabel.findFirst({
      where: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        labelId: label.id,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.entityLabel.create({
      data: {
        organizationId: input.organizationId,
        labelId: label.id,
        entityType: input.entityType,
        entityId: input.entityId,
        appliedByUserId: input.appliedByUserId ?? null,
      },
    });
  }

  /**
   * Remove a classification label (by code) from an entity.
   * Returns the number of removed rows.
   */
  async removeLabelFromEntity(
    input: RemoveLabelFromEntityInput,
  ): Promise<number> {
    const label = await this.getLabelDefinitionByCode(
      input.organizationId,
      input.labelCode,
    );

    const result = await this.prisma.entityLabel.deleteMany({
      where: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        labelId: label.id,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `EntityLabel not found for entity "${input.entityType}:${input.entityId}" and label code "${input.labelCode}".`,
      );
    }

    return result.count;
  }

  /**
   * List all EntityLabels (with resolved LabelDefinition) for a given entity.
   */
  async getLabelsForEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
  ): Promise<EntityLabelWithDefinition[]> {
    if (!entityType?.trim()) {
      throw new BadRequestException('entityType must be a non-empty string.');
    }
    if (!entityId?.trim()) {
      throw new BadRequestException('entityId must be a non-empty string.');
    }

    return this.prisma.entityLabel.findMany({
      where: {
        organizationId,
        entityType,
        entityId,
      },
      include: {
        label: true,
      },
    }) as Promise<EntityLabelWithDefinition[]>;
  }
}
