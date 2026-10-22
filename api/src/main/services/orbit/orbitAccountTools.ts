import container from '../../config/container';
import NotificationService from '../NotificationService';
import UserRepository from '../../repositories/mongoose/UserRepository';
import { OrbitNotificationChannels, OrbitProfileField } from '../../types/models/Orbit';
import { LlmTool } from './OrbitLlmClient';
import { OrbitActor } from './orbitAccess';

const DEFAULT_NOTIFICATIONS_LISTED = 20;
const MAX_NOTIFICATIONS_LISTED = 50;
const MAX_MESSAGE_LENGTH = 300;

/** The kinds of notification the settings page lets people tune, and how it names them. */
export const NOTIFICATION_KINDS = [
  { kind: 'OrganizationInvitation', label: 'Organization invitations' },
  { kind: 'System', label: 'System notices' },
  { kind: 'PricingUpdated', label: 'Updates of pricings you follow' },
];

export const PROFILE_FIELDS: Array<{ field: OrbitProfileField; label: string; social: boolean }> = [
  { field: 'displayName', label: 'display name', social: false },
  { field: 'bio', label: 'bio', social: false },
  { field: 'linkedin', label: 'LinkedIn', social: true },
  { field: 'instagram', label: 'Instagram', social: true },
  { field: 'facebook', label: 'Facebook', social: true },
  { field: 'x', label: 'X', social: true },
];

/** Read tools over the user's own account: their notifications and their public profile. */
export const ACCOUNT_TOOLS: LlmTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_notifications',
      description: `The user's notifications, newest first, and how many are unread. Up to ${MAX_NOTIFICATIONS_LISTED}.`,
      parameters: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'boolean' },
          limit: { type: 'number', description: `Default ${DEFAULT_NOTIFICATIONS_LISTED}.` },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_profile',
      description: "The user's public profile (display name, bio, social links) and which notifications reach them by email and in the app.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

export const ACCOUNT_TOOL_LABELS: Record<string, string> = {
  get_notifications: 'Reading your notifications',
  get_my_profile: 'Reading your profile',
};

/** The channels a kind reaches the user through; missing preferences are on, as NotificationService treats them. */
export function notificationChannelsOf(user: any, kind: string): OrbitNotificationChannels {
  const prefs: unknown = user?.settings?.notificationPrefs;
  const saved = (prefs instanceof Map ? prefs.get(kind) : (prefs as Record<string, any> | undefined)?.[kind]) as
    | Partial<OrbitNotificationChannels>
    | undefined;
  return { email: saved?.email !== false, inbox: saved?.inbox !== false };
}

/** The current value of a public profile field, empty when it is not set. */
export function profileValueOf(user: any, field: OrbitProfileField): string {
  const settings = user?.settings ?? {};
  const value = field === 'displayName' || field === 'bio' ? settings.profile?.[field] : settings.socialLinks?.[field];
  return typeof value === 'string' ? value : '';
}

/** Runs an account tool, or answers undefined when the name is not one of them. Everything here is the user's own. */
export async function runAccountTool(name: string, args: any, actor: OrbitActor): Promise<unknown | undefined> {
  switch (name) {
    case 'get_notifications': {
      const notificationService: NotificationService = container.resolve('notificationService');
      const requested = Number(args.limit);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_NOTIFICATIONS_LISTED) : DEFAULT_NOTIFICATIONS_LISTED;
      const [notifications, unread] = await Promise.all([
        notificationService.getNotifications(actor.id, { unreadOnly: args.unreadOnly === true, limit }),
        notificationService.getUnreadCount(actor.id),
      ]);
      return {
        unread,
        notifications: notifications.map((notification: any) => ({
          id: notification.id,
          kind: NOTIFICATION_KINDS.find(item => item.kind === notification.kind)?.label ?? notification.kind,
          title: notification.title,
          message: String(notification.message ?? '').slice(0, MAX_MESSAGE_LENGTH),
          read: notification.read === true,
          createdAt: notification.createdAt,
        })),
        page: '/notifications',
      };
    }

    case 'get_my_profile': {
      const userRepository: UserRepository = container.resolve('userRepository');
      const user = await userRepository.findById(actor.id);
      if (!user) throw new Error('NOT FOUND: User not found');
      return {
        username: user.username,
        profile: Object.fromEntries(PROFILE_FIELDS.map(({ field }) => [field, profileValueOf(user, field) || null])),
        notificationPreferences: NOTIFICATION_KINDS.map(({ kind, label }) => ({ kind, label, ...notificationChannelsOf(user, kind) })),
        page: '/me/settings',
      };
    }

    default:
      return undefined;
  }
}
