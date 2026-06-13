import { UserRole } from '../config/permissions';

export interface UserPublicProfile {
  displayName?: string;
  bio?: string;
  city?: string;
  country?: string;
  dateOfBirth?: string;
}

export interface UserSocialLinks {
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  x?: string;
}

export type NotificationChannel = 'email' | 'inbox';
export type NotificationKind =
  | 'OrganizationInvitation'
  | 'System'
  | 'CollectionShared'
  | 'PricingUpdated';

export type NotificationPreferences = Record<string, Record<NotificationChannel, boolean>>;

export interface UserSettings {
  phone?: string;
  avatar?: string;
  avatarBgColor?: string;
  avatarFgColor?: string;
  profile?: UserPublicProfile;
  socialLinks?: UserSocialLinks;
  notificationPrefs?: NotificationPreferences;
}

export interface LeanUser {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string;
  settings?: UserSettings;
  token?: string;
  tokenExpiration?: Date;
  apiKeys: ApiKey[];
}

export type LeanUserWithApiKey = (Omit<LeanUser, 'apiKeys' | 'password'> & { apiKey: ApiKey })

export type UserFilters = {
  username?: string;
  email?: string;
  role?: UserRole;
  q?: string;
};

export type ApiKey = {
  _id: string;
  key: string;
  name: string;
  revoked: boolean;
  expiresAt?: Date | null;
  scopes: { organizationId: string; scope: 'ALL' | 'MANAGEMENT' | 'VIEW' }[];
};

export type ApiKeySummary = {
  id: string;
  name: string;
  keyPreview: string;
  scopes: { organizationId: string; scope: 'ALL' | 'MANAGEMENT' | 'VIEW' }[];
  expiresAt?: Date | null;
  revoked: boolean;
  createdAt?: Date;
};
