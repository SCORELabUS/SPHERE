export interface GroupMembership {
  id: string;
  _userId: string;
  _groupId: string;
  role: 'admin' | 'editor' | 'viewer';
  joinedAt: Date;
}
