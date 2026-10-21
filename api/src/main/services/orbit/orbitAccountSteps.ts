import mongoose from 'mongoose';
import container from '../../config/container';
import NotificationRepository from '../../repositories/mongoose/NotificationRepository';
import UserRepository from '../../repositories/mongoose/UserRepository';
import { isValidSocialUrl } from '../UserSettingsService';
import {
  OrbitNotificationPreferenceChange,
  OrbitOperation,
  OrbitPlanDraft,
  OrbitProfileChange,
} from '../../types/models/Orbit';
import { OrbitActor } from './orbitAccess';
import { NOTIFICATION_KINDS, notificationChannelsOf, PROFILE_FIELDS, profileValueOf } from './orbitAccountTools';

export const ORBIT_ACCOUNT_LIMITS = {
  notificationsMarked: 100,
  displayNameLength: 100,
  // The same as the bio box of the settings page.
  bioLength: 200,
  socialLinkLength: 300,
};

const SOCIAL_EXAMPLES: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/in/your-name',
  instagram: 'https://www.instagram.com/your.name',
  facebook: 'https://www.facebook.com/your.name',
  x: 'https://x.com/your_name',
};

/**
 * Validates the account part of a plan: the user's own notifications, which of
 * them reach the user and how, and the public profile. Nothing here touches
 * anyone else, so the only check is that what the plan names is the user's.
 */
export class AccountStepBuilder {
  private user: any | undefined;

  constructor(private actor: OrbitActor) {}

  async notificationsRead(
    draft: OrbitPlanDraft['notificationsRead'],
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    if (!draft || typeof draft !== 'object') return [];
    const repository: NotificationRepository = container.resolve('notificationRepository');
    const ids = Array.isArray(draft.ids) ? [...new Set(draft.ids.map(id => String(id).trim()).filter(Boolean))] : [];

    if (draft.all === true) {
      if (ids.length > 0) {
        errors.push('Mark either every unread notification (all) or some of them (ids), not both.');
        return [];
      }
      const count = await repository.countUnread(this.actor.id);
      if (count === 0) {
        warnings.push('You have no unread notifications, so there is nothing to mark as read.');
        return [];
      }
      return [{ type: 'mark_notifications_read', all: true, count, notifications: [] }];
    }

    if (ids.length === 0) return [];
    if (ids.length > ORBIT_ACCOUNT_LIMITS.notificationsMarked) {
      errors.push(
        `A plan can mark at most ${ORBIT_ACCOUNT_LIMITS.notificationsMarked} notifications one by one (got ${ids.length}); mark them all instead.`
      );
      return [];
    }
    const found = await repository.findByIdsForUser(ids.filter(id => mongoose.isValidObjectId(id)), this.actor.id);
    const missing = ids.length - found.length;
    if (missing > 0) {
      warnings.push(`${missing} of the notifications named ${missing === 1 ? 'is' : 'are'} not among yours and ${missing === 1 ? 'was' : 'were'} left out.`);
    }
    const alreadyRead = found.filter(notification => notification.read === true).length;
    if (alreadyRead > 0) {
      warnings.push(`${alreadyRead} of them ${alreadyRead === 1 ? 'was' : 'were'} already read and left out.`);
    }
    const unread = found.filter(notification => notification.read !== true);
    if (unread.length === 0) return [];
    return [
      {
        type: 'mark_notifications_read',
        all: false,
        count: unread.length,
        notifications: unread.map(notification => ({ id: notification.id, title: String(notification.title ?? '').slice(0, 120) })),
      },
    ];
  }

  async notificationPreferences(
    items: NonNullable<OrbitPlanDraft['notificationPreferences']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    if (items.length === 0) return [];
    const user = await this.loadUser();
    const changes: OrbitNotificationPreferenceChange[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const raw = typeof item?.kind === 'string' ? item.kind.trim().toLowerCase() : '';
      const known = NOTIFICATION_KINDS.find(entry => entry.kind.toLowerCase() === raw || entry.label.toLowerCase() === raw);
      if (!known) {
        errors.push(`"${item?.kind ?? ''}" is not a kind of notification. Use one of: ${NOTIFICATION_KINDS.map(entry => entry.kind).join(', ')}.`);
        continue;
      }
      if (seen.has(known.kind)) {
        errors.push(`${known.label} appears more than once; give each kind of notification once.`);
        continue;
      }
      seen.add(known.kind);
      const from = notificationChannelsOf(user, known.kind);
      const to = {
        email: typeof item.email === 'boolean' ? item.email : from.email,
        inbox: typeof item.inbox === 'boolean' ? item.inbox : from.inbox,
      };
      if (to.email === from.email && to.inbox === from.inbox) {
        warnings.push(`${known.label} already reach you that way; left out.`);
        continue;
      }
      changes.push({ kind: known.kind, label: known.label, from, to });
    }
    return changes.length ? [{ type: 'update_notification_preferences', changes }] : [];
  }

  async profile(draft: OrbitPlanDraft['profile'], errors: string[], warnings: string[]): Promise<OrbitOperation[]> {
    if (!draft || typeof draft !== 'object') return [];
    const user = await this.loadUser();
    const changes: OrbitProfileChange[] = [];

    for (const { field, label, social } of PROFILE_FIELDS) {
      if (!(field in draft) || draft[field] === undefined) continue;
      const raw = draft[field];
      const to = typeof raw === 'string' ? raw.trim() : '';
      if (raw !== null && typeof raw !== 'string') {
        errors.push(`The ${label} must be text.`);
        continue;
      }
      if (field === 'displayName' && to.length > ORBIT_ACCOUNT_LIMITS.displayNameLength) {
        errors.push(`The display name can be at most ${ORBIT_ACCOUNT_LIMITS.displayNameLength} characters.`);
        continue;
      }
      if (field === 'bio' && to.length > ORBIT_ACCOUNT_LIMITS.bioLength) {
        errors.push(`The bio can be at most ${ORBIT_ACCOUNT_LIMITS.bioLength} characters (got ${to.length}).`);
        continue;
      }
      if (social && to) {
        if (to.length > ORBIT_ACCOUNT_LIMITS.socialLinkLength || !isValidSocialUrl(field, to)) {
          errors.push(`"${to}" is not a valid ${label} profile link; it should look like ${SOCIAL_EXAMPLES[field]}.`);
          continue;
        }
      }
      const from = profileValueOf(user, field);
      if (from === to) {
        warnings.push(`Your ${label} is already ${to ? `"${to}"` : 'empty'}; left out.`);
        continue;
      }
      changes.push({ field, label, from, to });
    }
    return changes.length ? [{ type: 'update_profile', changes }] : [];
  }

  private async loadUser(): Promise<any> {
    if (this.user === undefined) {
      const repository: UserRepository = container.resolve('userRepository');
      this.user = await repository.findById(this.actor.id);
      if (!this.user) throw new Error('NOT FOUND: User not found');
    }
    return this.user;
  }
}
