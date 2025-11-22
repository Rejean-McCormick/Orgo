// apps/api/src/orgo/backbone/identity/identity-link.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PersonProfile, UserAccount } from '@prisma/client';

import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { FN_IDENTITY_LINK_USER_TO_PERSON } from '../../core/functional-ids';
import type {
  IdentityLinkView,
  StandardResult,
} from './identity-link.controller';

/**
 * Input for creating or updating a user–person link.
 *
 * Multi‑tenant invariants:
 * - organizationId is required.
 * - userId and personId must both belong to organizationId.
 */
export interface LinkUserToPersonInput {
  organizationId: string;
  userId: string;
  personId: string;
  /**
   * When true, existing conflicting links may be broken in order to
   * apply this new link. When false, conflicts cause a validation error.
   */
  force: boolean;
}

/**
 * Input for unlinking a user–person pair.
 *
 * At least one of userId or personId must be provided.
 */
export interface UnlinkUserFromPersonInput {
  organizationId: string;
  userId?: string;
  personId?: string;
}

/**
 * Input for fetching the link for a given user.
 */
export interface GetLinkByUserIdInput {
  organizationId: string;
  userId: string;
}

/**
 * Input for fetching the link for a given person.
 */
export interface GetLinkByPersonIdInput {
  organizationId: string;
  personId: string;
}

/**
 * IdentityLinkService
 *
 * Responsibilities:
 * - Enforce the logical one‑to‑one link between UserAccount and PersonProfile
 *   within an organization via person_profiles.linked_user_id.
 * - Provide primitives to link, unlink and query the current link.
 * - Enforce multi‑tenant invariants explicitly via organizationId.
 *
 * All methods return the standard Core Services result shape:
 *   { ok: true, data, error: null } or
 *   { ok: false, data: null, error: { code, message, details? } }
 */
@Injectable()
export class IdentityLinkService {
  private readonly logger = new Logger(IdentityLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or update a link between a UserAccount and a PersonProfile.
   *
   * Invariants:
   * - organizationId, userId and personId are required.
   * - User and person must belong to the same organization.
   * - Each user should be linked to at most one person per organization.
   * - Each person should be linked to at most one user.
   *
   * When `force === false`, any conflicting existing links produce
   * an IDENTITY_LINK_CONFLICT error.
   *
   * When `force === true`, conflicting person_profiles rows for the
   * target user are detached (linked_user_id set to null) before
   * creating/updating the requested link.
   */
  async linkUserToPerson(
    input: LinkUserToPersonInput,
  ): Promise<StandardResult<IdentityLinkView>> {
    const { organizationId, userId, personId, force } = input;

    if (!organizationId || !userId || !personId) {
      return this.fail<IdentityLinkView>('IDENTITY_LINK_VALIDATION_ERROR', {
        message: 'organizationId, userId and personId are required.',
        details: { organizationId, userId, personId, force },
      });
    }

    this.logger.debug(
      `[${FN_IDENTITY_LINK_USER_TO_PERSON}] linkUserToPerson org=${organizationId} user=${userId} person=${personId} force=${force}`,
    );

    try {
      // Resolve user & person within the given organization.
      const [user, person] = await Promise.all([
        this.findUserInOrganization(organizationId, userId),
        this.findPersonInOrganization(organizationId, personId),
      ]);

      if (!user) {
        return this.fail<IdentityLinkView>('IDENTITY_LINK_USER_NOT_FOUND', {
          message: 'User account not found in the specified organization.',
          details: { organizationId, userId },
        });
      }

      if (!person) {
        return this.fail<IdentityLinkView>('IDENTITY_LINK_PERSON_NOT_FOUND', {
          message: 'Person profile not found in the specified organization.',
          details: { organizationId, personId },
        });
      }

      // Find any existing links for this user within the organization.
      const existingLinksForUser = await this.prisma.personProfile.findMany({
        where: { organizationId, linkedUserId: user.id },
      });

      const personHasDifferentLinkedUser =
        person.linkedUserId != null && person.linkedUserId !== user.id;

      const otherPersonsLinkedToUser = existingLinksForUser.filter(
        (p) => p.id !== person.id,
      );

      const hasConflict =
        personHasDifferentLinkedUser || otherPersonsLinkedToUser.length > 0;

      const isAlreadyLinked =
        !hasConflict && person.linkedUserId != null && person.linkedUserId === user.id;

      // No-op if the link already exists and there are no conflicts.
      if (isAlreadyLinked) {
        this.logger.debug(
          `[${FN_IDENTITY_LINK_USER_TO_PERSON}] linkUserToPerson: link already in desired state.`,
        );
        return this.ok(this.toView(organizationId, person));
      }

      if (hasConflict && !force) {
        return this.fail<IdentityLinkView>('IDENTITY_LINK_CONFLICT', {
          message:
            'Existing user–person link conflicts with requested link. Pass force=true to overwrite.',
          details: {
            organizationId,
            userId: user.id,
            personId: person.id,
            personCurrentLinkedUserId: person.linkedUserId,
            existingLinkedPersonIdsForUser: existingLinksForUser.map((p) => p.id),
          },
        });
      }

      // Apply changes in a transaction:
      // - detach any other persons currently linked to this user (same org)
      // - set linkedUserId on the requested person.
      const updatedPerson = await this.prisma.$transaction(async (tx) => {
        if (otherPersonsLinkedToUser.length > 0) {
          const idsToClear = otherPersonsLinkedToUser.map((p) => p.id);

          await tx.personProfile.updateMany({
            where: {
              organizationId,
              id: { in: idsToClear },
            },
            data: {
              linkedUserId: null,
            },
          });
        }

        const updated = await tx.personProfile.update({
          where: { id: person.id },
          data: {
            linkedUserId: user.id,
          },
        });

        return updated;
      });

      this.logger.debug(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] linkUserToPerson: link applied org=${organizationId} user=${user.id} person=${updatedPerson.id}`,
      );

      return this.ok(this.toView(organizationId, updatedPerson));
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? 'Unknown error');

      this.logger.error(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] linkUserToPerson failed: ${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      return this.fail<IdentityLinkView>('IDENTITY_LINK_PERSISTENCE_ERROR', {
        message: 'Failed to persist user–person link.',
        details: {
          organizationId,
          userId,
          personId,
          force,
          error: errorMessage,
        },
      });
    }
  }

  /**
   * Remove any link between a UserAccount and PersonProfile within an org.
   *
   * Behaviour:
   * - organizationId is required.
   * - At least one of userId or personId must be provided.
   * - If userId is provided and no such user exists in the org →
   *   IDENTITY_LINK_USER_NOT_FOUND error.
   * - If personId is provided and no such person exists in the org →
   *   IDENTITY_LINK_PERSON_NOT_FOUND error.
   * - All matching person_profiles rows for the given user and/or person
   *   are updated with linked_user_id = null.
   *
   * On success, data is typically null (no active link remains).
   */
  async unlinkUserFromPerson(
    input: UnlinkUserFromPersonInput,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const { organizationId, userId, personId } = input;

    if (!organizationId) {
      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_VALIDATION_ERROR',
        {
          message: 'organizationId is required.',
          details: { organizationId, userId, personId },
        },
      );
    }

    if (!userId && !personId) {
      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_VALIDATION_ERROR',
        {
          message: 'At least one of userId or personId must be provided.',
          details: { organizationId, userId, personId },
        },
      );
    }

    this.logger.debug(
      `[${FN_IDENTITY_LINK_USER_TO_PERSON}] unlinkUserFromPerson org=${organizationId} user=${userId ?? 'null'} person=${personId ?? 'null'}`,
    );

    try {
      let user: UserAccount | null = null;
      let personFromId: PersonProfile | null = null;

      if (userId) {
        user = await this.findUserInOrganization(organizationId, userId);
        if (!user) {
          return this.fail<IdentityLinkView | null>(
            'IDENTITY_LINK_USER_NOT_FOUND',
            {
              message: 'User account not found in the specified organization.',
              details: { organizationId, userId },
            },
          );
        }
      }

      if (personId) {
        personFromId = await this.findPersonInOrganization(
          organizationId,
          personId,
        );
        if (!personFromId) {
          return this.fail<IdentityLinkView | null>(
            'IDENTITY_LINK_PERSON_NOT_FOUND',
            {
              message:
                'Person profile not found in the specified organization.',
              details: { organizationId, personId },
            },
          );
        }
      }

      // Collect all person profiles whose links should be cleared.
      const personsToClear = new Map<string, PersonProfile>();

      if (personFromId) {
        personsToClear.set(personFromId.id, personFromId);
      }

      if (user) {
        const linkedPersons = await this.prisma.personProfile.findMany({
          where: {
            organizationId,
            linkedUserId: user.id,
          },
        });

        for (const p of linkedPersons) {
          personsToClear.set(p.id, p);
        }
      }

      const personIdsToClear = Array.from(personsToClear.keys());

      if (personIdsToClear.length === 0) {
        // Nothing to unlink – treat as idempotent success.
        this.logger.debug(
          `[${FN_IDENTITY_LINK_USER_TO_PERSON}] unlinkUserFromPerson: no active links found to clear.`,
        );
        return this.ok<IdentityLinkView | null>(null);
      }

      await this.prisma.personProfile.updateMany({
        where: {
          organizationId,
          id: { in: personIdsToClear },
        },
        data: {
          linkedUserId: null,
        },
      });

      this.logger.debug(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] unlinkUserFromPerson: cleared links for personIds=${personIdsToClear.join(
          ',',
        )}`,
      );

      // We intentionally return data=null to reflect "no active link remains".
      return this.ok<IdentityLinkView | null>(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? 'Unknown error');

      this.logger.error(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] unlinkUserFromPerson failed: ${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_PERSISTENCE_ERROR',
        {
          message: 'Failed to unlink user and person.',
          details: {
            organizationId,
            userId,
            personId,
            error: errorMessage,
          },
        },
      );
    }
  }

  /**
   * Fetch the current PersonProfile link for a given UserAccount.
   *
   * If the user exists but has no linked person, this returns
   * { ok: true, data: null }.
   */
  async getLinkByUserId(
    input: GetLinkByUserIdInput,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const { organizationId, userId } = input;

    if (!organizationId || !userId) {
      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_VALIDATION_ERROR',
        {
          message: 'organizationId and userId are required.',
          details: { organizationId, userId },
        },
      );
    }

    this.logger.debug(
      `[${FN_IDENTITY_LINK_USER_TO_PERSON}] getLinkByUserId org=${organizationId} user=${userId}`,
    );

    try {
      const user = await this.findUserInOrganization(organizationId, userId);

      if (!user) {
        return this.fail<IdentityLinkView | null>(
          'IDENTITY_LINK_USER_NOT_FOUND',
          {
            message: 'User account not found in the specified organization.',
            details: { organizationId, userId },
          },
        );
      }

      const persons = await this.prisma.personProfile.findMany({
        where: {
          organizationId,
          linkedUserId: user.id,
        },
      });

      if (persons.length === 0) {
        return this.ok<IdentityLinkView | null>(null);
      }

      if (persons.length > 1) {
        // Invariant violation: more than one person linked to the same user.
        this.logger.error(
          `[${FN_IDENTITY_LINK_USER_TO_PERSON}] Invariant violation: multiple person_profiles rows linked to user ${user.id} in org ${organizationId}. personIds=${persons
            .map((p) => p.id)
            .join(',')}`,
        );
      }

      const person = persons[0];
      return this.ok<IdentityLinkView | null>(
        this.toView(organizationId, person),
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? 'Unknown error');

      this.logger.error(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] getLinkByUserId failed: ${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_PERSISTENCE_ERROR',
        {
          message: 'Failed to fetch user–person link for user.',
          details: { organizationId, userId, error: errorMessage },
        },
      );
    }
  }

  /**
   * Fetch the current UserAccount link for a given PersonProfile.
   *
   * If the person exists but has no linked user, this returns
   * { ok: true, data: null }.
   */
  async getLinkByPersonId(
    input: GetLinkByPersonIdInput,
  ): Promise<StandardResult<IdentityLinkView | null>> {
    const { organizationId, personId } = input;

    if (!organizationId || !personId) {
      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_VALIDATION_ERROR',
        {
          message: 'organizationId and personId are required.',
          details: { organizationId, personId },
        },
      );
    }

    this.logger.debug(
      `[${FN_IDENTITY_LINK_USER_TO_PERSON}] getLinkByPersonId org=${organizationId} person=${personId}`,
    );

    try {
      const person = await this.findPersonInOrganization(
        organizationId,
        personId,
      );

      if (!person) {
        return this.fail<IdentityLinkView | null>(
          'IDENTITY_LINK_PERSON_NOT_FOUND',
          {
            message: 'Person profile not found in the specified organization.',
            details: { organizationId, personId },
          },
        );
      }

      if (!person.linkedUserId) {
        return this.ok<IdentityLinkView | null>(null);
      }

      return this.ok<IdentityLinkView | null>(
        this.toView(organizationId, person),
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err ?? 'Unknown error');

      this.logger.error(
        `[${FN_IDENTITY_LINK_USER_TO_PERSON}] getLinkByPersonId failed: ${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      return this.fail<IdentityLinkView | null>(
        'IDENTITY_LINK_PERSISTENCE_ERROR',
        {
          message: 'Failed to fetch user–person link for person.',
          details: { organizationId, personId, error: errorMessage },
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a user within an organization.
   * Returns null when no match is found.
   */
  private findUserInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<UserAccount | null> {
    return this.prisma.userAccount.findFirst({
      where: {
        id: userId,
        organizationId,
      },
    });
  }

  /**
   * Resolve a person within an organization.
   * Returns null when no match is found.
   */
  private findPersonInOrganization(
    organizationId: string,
    personId: string,
  ): Promise<PersonProfile | null> {
    return this.prisma.personProfile.findFirst({
      where: {
        id: personId,
        organizationId,
      },
    });
  }

  /**
   * Map a PersonProfile row into the IdentityLinkView shape.
   * Assumes person.linkedUserId is non‑null.
   */
  private toView(
    organizationId: string,
    person: PersonProfile,
  ): IdentityLinkView {
    if (!person.linkedUserId) {
      // This should never be called for an unlinked person.
      throw new Error(
        'Cannot build IdentityLinkView for a person without linkedUserId.',
      );
    }

    return {
      organizationId,
      userId: person.linkedUserId,
      personId: person.id,
    };
  }

  /**
   * Convenience helper for constructing a successful StandardResult.
   */
  private ok<T>(data: T | null): StandardResult<T> {
    return {
      ok: true,
      data,
      error: null,
    };
  }

  /**
   * Convenience helper for constructing a failed StandardResult.
   */
  private fail<T>(
    code: string,
    params:
      | { message: string; details?: Record<string, unknown> }
      | string,
  ): StandardResult<T> {
    const message =
      typeof params === 'string' ? params : params.message ?? code;
    const details =
      typeof params === 'string' ? undefined : params.details ?? undefined;

    return {
      ok: false,
      data: null,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    };
  }
}
