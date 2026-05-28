import { Navigate, Outlet, useRoutes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import LoadingView from '../modules/core/pages/loading';
import AppLayout from './app-layout';
import ProtectedRoute from '../modules/auth/components/protected-route';
import { useAuth } from '../modules/auth/hooks/useAuth';

import DashboardSkeleton from '../modules/core/components/skeletons/dashboard-skeleton';
import PricingListSkeleton from '../modules/core/components/skeletons/pricing-list-skeleton';
import PricingCardSkeleton from '../modules/core/components/skeletons/pricing-card-skeleton';
import CollectionsListSkeleton from '../modules/core/components/skeletons/collections-list-skeleton';
import CollectionCardSkeleton from '../modules/core/components/skeletons/collection-card-skeleton';
import OrgDetailSkeleton from '../modules/core/components/skeletons/org-detail-skeleton';
import OrgJoinSkeleton from '../modules/core/components/skeletons/org-join-skeleton';
import EditorSkeleton from '../modules/core/components/skeletons/editor-skeleton';

export const HomePage = lazy(() => import('../modules/presentation/pages/home'));
export const DashboardPage = lazy(() => import('../modules/presentation/pages/dashboard'));
export const TeamPage = lazy(() => import('../modules/presentation/pages/team'));
export const Page404 = lazy(() => import('../modules/core/pages/page-not-found'));
export const InboxPage = lazy(() => import('../modules/notification/pages/inbox'));

import EditorPage from '../modules/pricing-editor/pages/pricing2yaml-editor';
import EditorLayout from '../modules/pricing-editor/layouts/editor-layout';
import ResearchPage from '../modules/presentation/pages/research';
import ContributionsPage from '../modules/presentation/pages/contributions';
import PricingListPage from '../modules/pricing/pages/list';
import LoginPage from '../modules/auth/pages/login-page';
import RegisterPage from '../modules/auth/pages/register-page';
import CardPage from '../modules/pricing/pages/card';
import CreatePricingPage from '../modules/pricing/pages/create';
import CollectionCardPage from '../modules/pricing/pages/collection-card';
import CreateCollectionPage from '../modules/profile/pages/create-collection';
import CollectionsListPage from '../modules/pricing/pages/collections-list';
import UserPricingListPage from '../modules/pricing/pages/user-list';
import UserCollectionsListPage from '../modules/pricing/pages/user-collections-list';
import PricingAssistantPage from '../modules/harvey/pages/pricing-assistant';
import OrganizationsListPage from '../modules/organization/pages/organizations-list';
import CreateOrganizationPage from '../modules/organization/pages/create-organization';
import OrganizationDetailPage from '../modules/organization/pages/organization-detail';
import OrganizationJoinPage from '../modules/organization/pages/organization-join';
import SettingsPage from '../modules/settings/pages/SettingsPage';

function RootPage() {
  const { authUser } = useAuth();

  if (authUser.isLoading) {
    return <LoadingView />;
  }

  if (authUser.isAuthenticated) {
    return (
      <AppLayout>
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardPage />
        </Suspense>
      </AppLayout>
    );
  }

  return (
    <Suspense fallback={<LoadingView />}>
      <HomePage />
    </Suspense>
  );
}

export default function Router() {
  const routes = useRoutes([
    // ═══════════════════════════════════════════════════════════
    // ROOT PAGE (landing when not auth, dashboard when auth)
    // ═══════════════════════════════════════════════════════════
    {
      path: '/',
      element: <RootPage />,
    },

    // ═══════════════════════════════════════════════════════════
    // PUBLIC ROUTES (AppLayout: Public or Authenticated based on auth)
    // ═══════════════════════════════════════════════════════════
    {
      element: (
        <AppLayout>
          <Suspense fallback={<LoadingView />}>
            <Outlet />
          </Suspense>
        </AppLayout>
      ),
      children: [
        { element: <LoginPage />, path: '/login' },
        { element: <RegisterPage />, path: '/register' },
        {
          path: '/pricings',
          element: (
            <Suspense fallback={<PricingListSkeleton />}>
              <PricingListPage />
            </Suspense>
          ),
        },
        {
          path: '/pricings/:organizationId/:name',
          element: (
            <Suspense fallback={<PricingCardSkeleton />}>
              <CardPage />
            </Suspense>
          ),
        },
        {
          path: '/collections',
          element: (
            <Suspense fallback={<CollectionsListSkeleton />}>
              <CollectionsListPage />
            </Suspense>
          ),
        },
        {
          path: '/collections/:organizationId/:collectionSlug',
          element: (
            <Suspense fallback={<CollectionCardSkeleton />}>
              <CollectionCardPage />
            </Suspense>
          ),
        },
        { element: <TeamPage />, path: '/team' },
        { element: <ResearchPage />, path: '/research' },
        { element: <ContributionsPage />, path: '/contributions' },
        {
          path: '/orgs/:organizationId',
          element: (
            <Suspense fallback={<OrgDetailSkeleton />}>
              <OrganizationDetailPage />
            </Suspense>
          ),
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // PROTECTED ROUTES (require auth + AuthenticatedLayout)
    // ═══════════════════════════════════════════════════════════
    {
      element: (
        <ProtectedRoute>
          <AppLayout>
            <Suspense fallback={<LoadingView />}>
              <Outlet />
            </Suspense>
          </AppLayout>
        </ProtectedRoute>
      ),
      children: [
        { element: <CreatePricingPage />, path: '/pricings/new' },
        { element: <CreateCollectionPage />, path: '/collections/new' },
        { element: <OrganizationsListPage />, path: '/me/orgs' },
        { element: <SettingsPage />, path: '/me/settings' },
        { element: <UserPricingListPage />, path: '/me/pricings' },
        { element: <UserCollectionsListPage />, path: '/me/collections' },
        { element: <CreateOrganizationPage />, path: '/orgs/new' },
        {
          path: '/orgs/join/:code',
          element: (
            <Suspense fallback={<OrgJoinSkeleton />}>
              <OrganizationJoinPage />
            </Suspense>
          ),
        },
        {
          path: '/notifications',
          element: (
            <Suspense fallback={<LoadingView />}>
              <InboxPage />
            </Suspense>
          ),
        },
      ],
    },

    // ═══════════════════════════════════════════════════════════
    // EDITOR (standalone layout)
    // ═══════════════════════════════════════════════════════════
    {
      path: '/editor',
      element: (
        <EditorLayout>
          <Suspense fallback={<EditorSkeleton />}>
            <EditorPage />
          </Suspense>
        </EditorLayout>
      ),
    },

    // ═══════════════════════════════════════════════════════════
    // HARVEY (standalone layout)
    // ═══════════════════════════════════════════════════════════
    {
      path: '/harvey',
      element: (
        <Suspense fallback={<LoadingView />}>
          <PricingAssistantPage />
        </Suspense>
      ),
    },

    // ═══════════════════════════════════════════════════════════
    // ERROR / CATCH-ALL
    // ═══════════════════════════════════════════════════════════
    {
      path: 'error',
      element: <Page404 />,
    },
    {
      path: '*',
      element: <Navigate to="/error" replace />,
    },
  ]);

  return routes;
}
