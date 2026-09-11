export interface Organization {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  avatar?: string | null;
  avatarBgColor?: string | null;
  avatarFgColor?: string | null;
  isPersonal: boolean;
  createdAt: Date;
  updatedAt: Date;
}
