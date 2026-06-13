export interface Organization {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  avatar?: string | null;
  isPersonal: boolean;
  createdAt: Date;
  updatedAt: Date;
}
