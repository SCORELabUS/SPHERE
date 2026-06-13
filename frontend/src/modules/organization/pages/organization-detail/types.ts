export interface TreeNode {
  id: string;
  displayName: string;
  name: string;
  avatar: string | null;
  isPersonal: boolean;
  _parentId: string | null;
  children: TreeNode[];
  hasAccess: boolean;
  isAncestor?: boolean;
  isCurrent?: boolean;
}

export type Tab = 'overview' | 'members' | 'invitations' | 'pricings' | 'collections' | 'children' | 'permissions';

export const PER_PAGE = 10;
