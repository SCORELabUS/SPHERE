import { OrgRole } from '../../api/organizationsApi';
import { Tab } from './types';
import { IconType } from 'react-icons';
import { FaFileInvoiceDollar } from 'react-icons/fa';

export const ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export const ROLE_COLORS: Record<OrgRole, string> = {
  OWNER: 'bg-tp-primary/10 text-tp-primary',
  ADMIN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  MEMBER: 'bg-tp-surface text-tp-steel',
};

/** `beta` marks the tabs that only exist with beta features on. */
export const TAB_META: Record<Tab, { label: string; icon: string; iconComponent?: IconType; beta?: boolean }> = {
  overview: { label: 'Overview', icon: 'mdi:view-dashboard-outline' },
  members: { label: 'Members', icon: 'mdi:account-group-outline' },
  invitations: { label: 'Invitations', icon: 'mdi:link-variant' },
  pricings: { label: 'Pricings', icon: 'mdi:tag-outline', iconComponent: FaFileInvoiceDollar },
  collections: { label: 'Collections', icon: 'mdi:folder-outline' },
  services: { label: 'Services', icon: 'mdi:file-tree-outline', beta: true },
  children: { label: 'Hierarchy', icon: 'mdi:graph-outline' },
  permissions: { label: 'Permissions', icon: 'mdi:shield-lock-outline' },
};
