import { createContext } from 'react';
import { Organization } from '../api/organizationsApi';

export interface OrganizationContextInterface {
  organizations: Organization[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  setPage: (page: number) => void;
  refresh: () => void;
}

const OrganizationContext = createContext<OrganizationContextInterface>({
  organizations: [],
  isLoading: true,
  page: 1,
  totalPages: 1,
  setPage: () => {},
  refresh: () => {},
});

export default OrganizationContext;
