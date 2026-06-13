# Settings Bug Fix Plan

## Problem Analysis

### Bug 1: State not syncing after save in AccountSection

**Root cause:** `SettingsPage.updateSettings` (line 48-52) only passes `partial.settings` to `updateUserSettings`. But `AccountSection` edits top-level `UserSettings` fields (`firstName`, `lastName`, `email`) which live on `authUser.user`, NOT inside `authUser.user.settings`. These fields never get updated in the auth context.

**Effects:**
- `hasChanges` stays `true` forever because local state has new values but `settings` prop still has old values
- Avatar initials don't update because `authUser.user.firstName`/`lastName` aren't refreshed
- "Unsaved changes" indicator persists incorrectly

### Bug 2: No unsaved changes warning on section switch

Currently, clicking a different settings tab immediately switches without checking for dirty state.

## Fix 1: Update top-level user fields in `updateSettings`

**File:** `frontend/src/modules/settings/pages/SettingsPage.tsx`

Modify `updateSettings` to also call `updateUser` with top-level fields from the API response:

```tsx
const updateSettings = useCallback((partial: Partial<UserSettings>) => {
  if (partial.settings) {
    updateUserSettings(partial.settings);
  }
  const userFields: Record<string, unknown> = {};
  if (partial.firstName !== undefined) userFields.firstName = partial.firstName;
  if (partial.lastName !== undefined) userFields.lastName = partial.lastName;
  if (partial.email !== undefined) userFields.email = partial.email;
  if (Object.keys(userFields).length > 0) {
    updateUser(userFields);
  }
}, [updateUserSettings, updateUser]);
```

This works because React 18 automatic batching composes the two functional `setAuthUser` updaters correctly — the second updater sees the state produced by the first.

**No changes needed in AccountSection** for state re-sync: after the context updates, `settings` prop recomputes via `buildUserSettings(authUser)`, and the local `useState` values (which already match what was saved) will correctly produce `hasChanges = false`.

## Fix 2: Unsaved changes confirmation on section switch

### Approach

1. Add `onDirtyChange?: (dirty: boolean) => void` prop to each editable section
2. Each section calls `onDirtyChange(hasChanges)` via `useEffect` when dirty state changes
3. `SettingsPage` tracks dirty state per section in a `Record<SectionId, boolean>`
4. When user clicks a different section tab, check if current section is dirty
5. If dirty, show a custom confirm dialog (not `window.confirm`)
6. User can choose "Discard" (switch) or "Stay" (cancel switch)

### New component: `UnsavedChangesDialog.tsx`

**File:** `frontend/src/modules/settings/components/UnsavedChangesDialog.tsx`

A modal dialog with:
- Backdrop overlay
- Title: "Unsaved changes"
- Description: "You have unsaved changes that will be lost. Do you want to discard them?"
- Two buttons: "Discard" (destructive) and "Stay" (primary)
- Animated with framer-motion (consistent with existing UI)

### Files to modify

| File | Change |
|------|--------|
| `SettingsPage.tsx` | Fix `updateSettings`, add dirty tracking, add section-switch guard, render dialog |
| `AccountSection.tsx` | Add `onDirtyChange` prop, call it via `useEffect` |
| `PublicProfileSection.tsx` | Add `onDirtyChange` prop, call it via `useEffect` |
| `SocialLinksSection.tsx` | Add `onDirtyChange` prop, call it via `useEffect` |
| `NotificationsSection.tsx` | Add `hasChanges` tracking + `onDirtyChange` prop |

### New file

| File | Description |
|------|-------------|
| `UnsavedChangesDialog.tsx` | Custom confirm dialog component |

## Verification

1. Edit firstName in AccountSection → save → verify `hasChanges` disappears, avatar initials update in navbar
2. Edit a field → click different section tab → verify dialog appears
3. Click "Stay" → verify stays on current section with changes intact
4. Click "Discard" → verify switches to new section
5. Run `pnpm run test` from root to check for regressions
