import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

export type OrgoEntity = Prisma.ModelName;

export interface OrgoRepository<TRecord = any> {
  /**
   * Generic passthrough to Prisma `<model>.findMany` with optional tenant enforcement.
   */
  findMany(args?: any, organizationIdOverride?: string): Promise<TRecord[]>;

  /**
   * Generic passthrough to Prisma `<model>.findFirst` with optional tenant enforcement.
   */
  findFirst(args?: any, organizationIdOverride?: string): Promise<TRecord | null>;

  /**
   * Generic passthrough to Prisma `<model>.findUnique` with optional tenant enforcement.
   */
  findUnique(args: any, organizationIdOverride?: string): Promise<TRecord | null>;

  /**
   * Convenience helper for the common `id` + `organization_id` pattern.
   */
  findById(
    id: string,
    options?: {
      organizationId?: string;
      select?: any;
      include?: any;
    },
  ): Promise<TRecord | null>;

  /**
   * Generic passthrough to Prisma `<model>.create` with tenant enforcement on `data.organization_id`.
   */
  create(args: any, organizationIdOverride?: string): Promise<TRecord>;

  /**
   * Generic passthrough to Prisma `<model>.createMany` with tenant enforcement on each item in `data`.
   */
  createMany(
    args: any,
    organizationIdOverride?: string,
  ): Promise<Prisma.BatchPayload>;

  /**
   * Generic passthrough to Prisma `<model>.update` with optional tenant enforcement on `where` + `data`.
   */
  update(args: any, organizationIdOverride?: string): Promise<TRecord>;

  /**
   * Generic passthrough to Prisma `<model>.updateMany` with optional tenant enforcement on `where` + `data`.
   */
  updateMany(
    args: any,
    organizationIdOverride?: string,
  ): Promise<Prisma.BatchPayload>;

  /**
   * Generic passthrough to Prisma `<model>.delete` with optional tenant enforcement on `where`.
   */
  delete(args: any, organizationIdOverride?: string): Promise<TRecord>;

  /**
   * Generic passthrough to Prisma `<model>.deleteMany` with optional tenant enforcement on `where`.
   */
  deleteMany(
    args: any,
    organizationIdOverride?: string,
  ): Promise<Prisma.BatchPayload>;
}

/**
 * RepositoryFactoryService
 *
 * Central factory for Orgo repositories. It wraps Prisma model delegates and:
 * - Provides a consistent `.getRepository(entity)` entry point.
 * - Enforces multi‑tenant scoping by injecting `organization_id` where requested.
 * - Adds simple helpers like `findById`.
 *
 * It is intentionally light on TypeScript generics so it can work across all
 * Orgo entities without needing to update this file when new Prisma models
 * are added.
 */
@Injectable()
export class RepositoryFactoryService {
  private readonly logger = new Logger(RepositoryFactoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a repository wrapper for the given Prisma model name.
   *
   * Example usage:
   *
   *   const tasksRepo = repositoryFactory.getRepository('Task', orgId);
   *   const tasks = await tasksRepo.findMany({ where: { status: 'PENDING' } });
   */
  getRepository<TRecord = any>(
    entity: OrgoEntity,
    organizationId?: string,
  ): OrgoRepository<TRecord> {
    const delegate = this.getDelegate(entity);
    const baseOrgId = organizationId;

    const applyOrgFilter = (where: any, orgOverride?: string) =>
      this.applyOrganizationFilter(where, orgOverride ?? baseOrgId);

    const applyOrgToCreateArgs = (args: any, orgOverride?: string) =>
      this.applyOrganizationToCreateArgs(args, orgOverride ?? baseOrgId);

    const applyOrgToUpdateArgs = (args: any, orgOverride?: string) =>
      this.applyOrganizationToUpdateArgs(args, orgOverride ?? baseOrgId);

    const repo: OrgoRepository<TRecord> = {
      findMany: async (args: any = {}, orgOverride?: string) => {
        const prismaArgs = { ...(args || {}) };
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.findMany(prismaArgs);
      },

      findFirst: async (args: any = {}, orgOverride?: string) => {
        const prismaArgs = { ...(args || {}) };
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.findFirst(prismaArgs);
      },

      findUnique: async (args: any, orgOverride?: string) => {
        const prismaArgs = { ...(args || {}) };
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.findUnique(prismaArgs);
      },

      findById: async (
        id: string,
        options?: { organizationId?: string; select?: any; include?: any },
      ) => {
        const targetOrgId = options?.organizationId ?? baseOrgId;
        const where = applyOrgFilter({ id }, targetOrgId);
        const prismaArgs: any = {
          where,
          ...(options?.select ? { select: options.select } : {}),
          ...(options?.include ? { include: options.include } : {}),
        };
        return delegate.findUnique(prismaArgs);
      },

      create: async (args: any, orgOverride?: string) => {
        const prismaArgs = applyOrgToCreateArgs(args || {}, orgOverride);
        return delegate.create(prismaArgs);
      },

      createMany: async (args: any, orgOverride?: string) => {
        const prismaArgs = applyOrgToCreateArgs(args || {}, orgOverride);
        return delegate.createMany(prismaArgs);
      },

      update: async (args: any, orgOverride?: string) => {
        const prismaArgs = applyOrgToUpdateArgs(args || {}, orgOverride);
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.update(prismaArgs);
      },

      updateMany: async (args: any, orgOverride?: string) => {
        const prismaArgs = applyOrgToUpdateArgs(args || {}, orgOverride);
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.updateMany(prismaArgs);
      },

      delete: async (args: any, orgOverride?: string) => {
        const prismaArgs = { ...(args || {}) };
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.delete(prismaArgs);
      },

      deleteMany: async (args: any, orgOverride?: string) => {
        const prismaArgs = { ...(args || {}) };
        prismaArgs.where = applyOrgFilter(prismaArgs.where, orgOverride);
        return delegate.deleteMany(prismaArgs);
      },
    };

    return repo;
  }

  /**
   * Resolves a Prisma model delegate (e.g. `prisma.task`, `prisma.case`) from
   * a Prisma model name (e.g. `"Task"`, `"Case"`).
   */
  private getDelegate(entity: OrgoEntity): any {
    const delegatePropertyName =
      entity.charAt(0).toLowerCase() + entity.slice(1);

    const delegate = (this.prisma as any)[delegatePropertyName];

    if (!delegate) {
      const message = `No Prisma delegate found for entity "${entity}" (expected property "${delegatePropertyName}" on PrismaService)`;
      this.logger.error(message);
      throw new Error(message);
    }

    return delegate;
  }

  /**
   * Injects `organization_id` into `where` clauses when an organizationId is
   * provided. If `organization_id` is already present with a different value,
   * it throws to prevent cross‑tenant leakage.
   */
  private applyOrganizationFilter(
    originalWhere: any | undefined,
    organizationId?: string,
  ): any | undefined {
    if (!organizationId) {
      return originalWhere;
    }

    if (originalWhere == null) {
      return { organization_id: organizationId };
    }

    if (typeof originalWhere !== 'object') {
      return originalWhere;
    }

    if ('organization_id' in originalWhere) {
      const existing = (originalWhere as any).organization_id;

      if (existing && existing !== organizationId) {
        const message =
          'Cross-tenant query prevented: where.organization_id does not match requested organizationId.';
        this.logger.error(message);
        throw new Error(message);
      }

      return { ...originalWhere, organization_id: existing ?? organizationId };
    }

    return { ...originalWhere, organization_id: organizationId };
  }

  /**
   * Injects `organization_id` into `create` payloads (including createMany)
   * when an organizationId is provided. If `organization_id` is already set
   * to a different value on any item, it throws.
   */
  private applyOrganizationToCreateArgs(
    args: any,
    organizationId?: string,
  ): any {
    if (!organizationId || !args || typeof args !== 'object') {
      return args;
    }

    if (!('data' in args)) {
      return args;
    }

    const originalData = (args as any).data;

    if (Array.isArray(originalData)) {
      const data = originalData.map((item) =>
        this.applyOrganizationToData(item, organizationId),
      );
      return { ...args, data };
    }

    const data = this.applyOrganizationToData(originalData, organizationId);
    return { ...args, data };
  }

  /**
   * Injects `organization_id` into `update` payloads where a row is org‑scoped.
   * This primarily ensures we don't accidentally move a record between tenants.
   */
  private applyOrganizationToUpdateArgs(
    args: any,
    organizationId?: string,
  ): any {
    if (!organizationId || !args || typeof args !== 'object') {
      return args;
    }

    if (!('data' in args)) {
      return args;
    }

    const originalData = (args as any).data;
    const data = this.applyOrganizationToData(originalData, organizationId);
    return { ...args, data };
  }

  /**
   * Helper to apply `organization_id` to a single data object.
   */
  private applyOrganizationToData(
    originalData: any,
    organizationId: string,
  ): any {
    if (!originalData || typeof originalData !== 'object') {
      return originalData;
    }

    if ('organization_id' in originalData) {
      const existing = (originalData as any).organization_id;

      if (existing && existing !== organizationId) {
        const message =
          'Cross-tenant write prevented: data.organization_id does not match requested organizationId.';
        this.logger.error(message);
        throw new Error(message);
      }

      return {
        ...originalData,
        organization_id: existing ?? organizationId,
      };
    }

    return {
      ...originalData,
      organization_id: organizationId,
    };
  }
}
