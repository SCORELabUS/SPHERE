import { useContext, useEffect, useState, useCallback, useRef } from 'react';
import OrganizationContext from '../contexts/organizationContext';
import { Organization, useOrganizationsApi } from '../api/organizationsApi';
import { useAuth } from '../../auth/hooks/useAuth';

const PER_PAGE = 10;

export const useOrganization = () => {
  return useContext(OrganizationContext);
};

export const useOrganizationManager = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const { authUser } = useAuth();
  const { getMyOrganizations } = useOrganizationsApi();
  const getMyOrganizationsRef = useRef(getMyOrganizations);
  getMyOrganizationsRef.current = getMyOrganizations;

  useEffect(() => {
    if (!authUser.isAuthenticated || authUser.isLoading) {
      if (!authUser.isLoading) {
        setOrganizations([]);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    const offset = (page - 1) * PER_PAGE;
    getMyOrganizationsRef.current({ limit: PER_PAGE, offset })
      .then((result) => {
        if (Array.isArray(result)) {
          setOrganizations(result);
          setTotalPages(1);
        } else {
          setOrganizations(result.items);
          setTotalPages(Math.max(1, Math.ceil(result.total / PER_PAGE)));
        }
      })
      .catch(() => {
        setOrganizations([]);
        setTotalPages(1);
      })
      .finally(() => setIsLoading(false));
  }, [authUser.isAuthenticated, authUser.isLoading, page, refreshKey]);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { organizations, isLoading, page, totalPages, setPage: handlePageChange, refresh };
};
