import { useEffect, useState } from 'react';
import VisibilityOptions from '../visibility-options';
import Iconify from '../../../core/components/iconify';
import type { VersionData } from '../../types/card';
import type { EntityPermissions } from '../../../organization/types/permissions';

interface PricingSettingsTabProps {
  entityPermissions: EntityPermissions | null;
  visibility: string;
  pricingName: string;
  currentVersion: VersionData | null;
  onVisibilityChange: () => void;
  onRename: (newName: string) => void;
  onDeleteCurrentVersion: () => void;
  onDeletePricing: () => void;
}

export default function PricingSettingsTab({
  entityPermissions,
  visibility,
  pricingName,
  currentVersion,
  onVisibilityChange,
  onRename,
  onDeleteCurrentVersion,
  onDeletePricing,
}: PricingSettingsTabProps) {
  const [nameValue, setNameValue] = useState(pricingName);

  useEffect(() => {
    setNameValue(pricingName);
  }, [pricingName]);

  function handleRename() {
    const newName = nameValue.trim();
    if (!newName || newName === pricingName) return;
    onRename(newName);
  }

  return (
    <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-5">
      {entityPermissions?.PUT && (
        <div>
          <h3 className="mb-4 text-sm font-medium text-tp-ink">General</h3>

          <div className="mb-6">
            <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Name</label>
            <div className="flex items-center gap-3">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="flex-1 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none transition-colors focus:border-tp-primary"
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={!nameValue.trim() || nameValue === pricingName}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-default disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>

          <h3 className="mb-2 text-sm font-medium text-tp-ink">Visibility</h3>
          <div className="pl-4">
            <VisibilityOptions value={visibility} onChange={onVisibilityChange} />
          </div>
        </div>
      )}

      {entityPermissions?.PUT && entityPermissions?.DELETE && (
        <hr className="my-6 border-tp-hairline" />
      )}

      {entityPermissions?.DELETE && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-red-500">Danger Zone</h3>

          {currentVersion && (
            <div className="rounded-lg border border-red-500 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-tp-ink">Delete current version ({currentVersion.version})</p>
                  <p className="mt-1 text-xs text-tp-steel">Once you delete this version, there is no going back. Other versions will remain intact.</p>
                </div>
                <button
                  type="button"
                  onClick={onDeleteCurrentVersion}
                  className="cursor-pointer shrink-0 rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-500 hover:text-white"
                >
                  Delete version
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-red-500 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-tp-ink">Delete this pricing</p>
                <p className="mt-1 text-xs text-tp-steel">Once you delete a pricing, there is no going back. Please be certain.</p>
              </div>
              <button
                type="button"
                onClick={onDeletePricing}
                className="cursor-pointer shrink-0 rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-500 hover:text-white"
              >
                Delete pricing
              </button>
            </div>
          </div>
        </div>
      )}

      {!entityPermissions?.PUT && !entityPermissions?.DELETE && (
        <div className="flex flex-col items-center gap-2 py-10 text-tp-steel">
          <Iconify icon="mdi:lock-outline" width={36} />
          <p className="text-sm">You don't have any edit or delete permissions for this pricing.</p>
        </div>
      )}
    </div>
  );
}
