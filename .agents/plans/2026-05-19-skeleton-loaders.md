# Plan: Global Skeleton Loaders for All Pages

## Goal
Replace all ad-hoc loading indicators (spinners, dashes, text) with consistent skeleton loaders using `react-loading-skeleton` across all data-fetching pages. Skip `OrganizationsListPage` (another agent working on it).

## Pages Requiring Skeletons

| Page | Current Loading | Action |
|---|---|---|
| **DashboardPage** | `--` dashes for stats | New skeleton |
| **PricingListPage** | Inline pulse divs | Replace with `react-loading-skeleton` |
| **CardPage** | Spinner | New skeleton |
| **CollectionsListPage** | Inline pulse divs | Replace with `react-loading-skeleton` |
| **CollectionCardPage** | Spinner + partial skeleton | Replace with `react-loading-skeleton` |
| **OrganizationDetailPage** | Spinner + text | New skeleton |
| **OrganizationJoinPage** | Text only | New skeleton |
| **EditorPage** | LoadingView spinner | New skeleton (2-column split) |

**Static pages (no skeleton needed):** HomePage, TeamPage, ResearchPage, ContributionsPage, LoginPage, RegisterPage, CreatePricingPage, CreateCollectionPage, CreateOrganizationPage, PricingAssistantPage, NotFoundPage, LegacyPricingCard, SettingsPage

## Implementation Steps

### 1. Install `react-loading-skeleton`
```bash
cd frontend && pnpm add react-loading-skeleton
```

### 2. Create global skeleton theme wrapper
**File:** `frontend/src/modules/core/components/skeleton-theme-provider/index.tsx`

- Wrap `SkeletonTheme` from `react-loading-skeleton`
- Use project colors: `baseColor="#ededed"` (tp-hairline), `highlightColor="#fafafa"` (tp-surface)
- Dark mode variants: `baseColor="#222222"`, `highlightColor="#1a1a1a"`
- Import `react-loading-skeleton/dist/skeleton.css` in main.tsx

### 3. Create skeleton components per page layout
**Directory:** `frontend/src/modules/core/components/skeletons/`

Each skeleton mirrors the actual page layout structure:

| File | Mirrors | Structure |
|---|---|---|
| `dashboard-skeleton.tsx` | DashboardPage | Welcome header + 3 stat cards + 2-col grid (org cards + pricing cards + collection cards) + sidebar |
| `pricing-list-skeleton.tsx` | PricingListPage | Header + search bar + 3×4 grid of card placeholders |
| `pricing-card-skeleton.tsx` | CardPage | Breadcrumb + title + 4 stats + tab bar + 2-col content |
| `collections-list-skeleton.tsx` | CollectionsListPage | Header + search bar + 3×3 grid of card placeholders |
| `collection-card-skeleton.tsx` | CollectionCardPage | Header + 4 stats + tab bar + pricing grid |
| `org-detail-skeleton.tsx` | OrganizationDetailPage | Hero header with avatar + stats + tab nav + tab content |
| `org-join-skeleton.tsx` | OrganizationJoinPage | Centered card with avatar + text lines + buttons |
| `editor-skeleton.tsx` | EditorPage | 2-column split (editor left, preview right) |

### 4. Update router to use skeleton fallbacks
**File:** `frontend/src/routes/router.tsx`

- Replace `<LoadingView />` Suspense fallbacks with page-specific skeleton components
- For lazy-loaded routes (HomePage, DashboardPage, TeamPage, Page404): skeleton fallback in Suspense
- For non-lazy data-fetching routes: skeleton shown inside the page component during `isLoading`

### 5. Update each data-fetching page
For each page, replace the current loading state (`isLoading ? <spinner/> : ...`) with the corresponding skeleton component.

## Files to Create/Modify

**Create:**
- `frontend/src/modules/core/components/skeleton-theme-provider/index.tsx`
- `frontend/src/modules/core/components/skeletons/dashboard-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/pricing-list-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/pricing-card-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/collections-list-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/collection-card-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/org-detail-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/org-join-skeleton.tsx`
- `frontend/src/modules/core/components/skeletons/editor-skeleton.tsx`

**Modify:**
- `frontend/package.json` (install dependency)
- `frontend/src/main.tsx` (import skeleton CSS + wrap with theme)
- `frontend/src/routes/router.tsx` (skeleton fallbacks in Suspense)
- `frontend/src/modules/presentation/pages/dashboard/index.tsx`
- `frontend/src/modules/pricing/pages/list/index.tsx`
- `frontend/src/modules/pricing/pages/card/index.tsx`
- `frontend/src/modules/pricing/pages/collections-list/index.tsx`
- `frontend/src/modules/pricing/pages/collection-card/index.tsx`
- `frontend/src/modules/organization/pages/organization-detail/index.tsx`
- `frontend/src/modules/organization/pages/organization-join/index.tsx`
- `frontend/src/modules/pricing-editor/pages/pricing2yaml-editor/index.tsx`

## Verification
- `pnpm run build` in frontend to verify no TypeScript errors
- Visual check: navigate to each page and confirm skeleton appears during loading
