import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';

import { Role } from './role.entity';
import { Permission } from './permission.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  /**
   * Returns all roles, including their permissions, ordered by name.
   */
  async findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      relations: { permissions: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Returns a single role by id or throws if it does not exist.
   */
  async findById(id: string): Promise<Role> {
    return this.getRoleOrThrow(id);
  }

  /**
   * Returns a single role by slug, or null if it does not exist.
   */
  async findBySlug(slug: string): Promise<Role | null> {
    return this.roleRepository.findOne({
      where: { slug },
      relations: { permissions: true },
    });
  }

  /**
   * Creates a new role.
   *
   * - Ensures the slug is unique.
   * - Optionally derives slug from the name if not provided.
   * - Optionally attaches a set of permissions.
   */
  async create(input: CreateRoleDto): Promise<Role> {
    const slug = input.slug
      ? this.normalizeSlug(input.slug)
      : this.slugify(input.name);

    await this.ensureSlugIsUnique(slug);

    const role = this.roleRepository.create({
      name: input.name,
      slug,
      description: input.description ?? null,
    });

    await this.applyPermissions(role, input.permissionIds);

    return this.roleRepository.save(role);
  }

  /**
   * Updates an existing role.
   *
   * - Throws if the role does not exist.
   * - Ensures new slug (if provided and changed) is unique.
   * - Optionally updates permissions.
   */
  async update(id: string, input: UpdateRoleDto): Promise<Role> {
    const role = await this.getRoleOrThrow(id);

    if (typeof input.name === 'string') {
      role.name = input.name;
    }

    if (typeof input.description === 'string' || input.description === null) {
      role.description = input.description;
    }

    if (
      typeof input.slug === 'string' &&
      input.slug.trim() !== '' &&
      input.slug !== role.slug
    ) {
      const slug = this.normalizeSlug(input.slug);
      await this.ensureSlugIsUnique(slug, role.id);
      role.slug = slug;
    }

    await this.applyPermissions(role, input.permissionIds);

    return this.roleRepository.save(role);
  }

  /**
   * Deletes a role permanently.
   *
   * Throws if the role does not exist.
   */
  async remove(id: string): Promise<void> {
    const role = await this.getRoleOrThrow(id);
    await this.roleRepository.remove(role);
  }

  /**
   * Replaces the full permission set for a role.
   *
   * This is a convenience wrapper over `update` that only deals with permissions.
   */
  async updatePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<Role> {
    const role = await this.getRoleOrThrow(roleId);
    await this.applyPermissions(role, permissionIds);
    return this.roleRepository.save(role);
  }

  /**
   * Internal helper to fetch a role or throw a NotFoundException.
   */
  private async getRoleOrThrow(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: { permissions: true },
    });

    if (!role) {
      throw new NotFoundException(`Role with id "${id}" not found.`);
    }

    return role;
  }

  /**
   * Ensures the slug is unique across all roles.
   *
   * If ignoreRoleId is provided, that role will be excluded from the uniqueness check
   * (useful when updating an existing role).
   */
  private async ensureSlugIsUnique(
    slug: string,
    ignoreRoleId?: string,
  ): Promise<void> {
    const where = ignoreRoleId ? { slug, id: Not(ignoreRoleId) } : { slug };

    const existing = await this.roleRepository.findOne({ where });

    if (existing) {
      throw new ConflictException(`Role with slug "${slug}" already exists.`);
    }
  }

  /**
   * Applies the given permission ids to the provided role instance.
   *
   * If permissionIds is:
   * - undefined: do nothing (keep existing permissions).
   * - []: clear all permissions.
   * - non-empty array: replace with the given set, validating that all exist.
   */
  private async applyPermissions(
    role: Role,
    permissionIds?: string[] | null,
  ): Promise<void> {
    if (permissionIds === undefined) {
      return;
    }

    if (!permissionIds || permissionIds.length === 0) {
      role.permissions = [];
      return;
    }

    const permissions = await this.permissionRepository.find({
      where: { id: In(permissionIds) },
    });

    const foundIds = new Set(permissions.map((p) => p.id));
    const missing = permissionIds.filter((id) => !foundIds.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown permission id(s): ${missing.join(', ')}`,
      );
    }

    role.permissions = permissions;
  }

  /**
   * Normalizes a user-provided slug string.
   */
  private normalizeSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Slug cannot be empty.');
    }
    return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /**
   * Generates a slug from a role name.
   */
  private slugify(name: string): string {
    if (!name || !name.trim()) {
      throw new BadRequestException(
        'Role name is required to generate a slug.',
      );
    }

    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
