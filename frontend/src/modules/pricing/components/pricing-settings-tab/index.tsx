import VisibilityOptions from '../visibility-options';
import Iconify from '../../../core/components/iconify';
import type { VersionData } from '../../types/card';
import type { EntityPermissions } from '../../../organization/types/permissions';

interface PricingSettingsTabProps {
  entityPermissions: EntityPermissions | null;
  visibility: string;
  currentVersion: VersionData | null;
  onVisibilityChange: () => void;
  onDeleteCurrentVersion: () => void;
  onDeletePricing: () => void;
}

export default function PricingSettingsTab({
  entityPermissions,
  visibility,
  currentVersion,
  onVisibilityChange,
  onDeleteCurrentVersion,
  onDeletePricing,
}: PricingSettingsTabProps) {
  return (
    <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-5">
      {entityPermissions?.PUT && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-tp-ink">Visibility</h3>
          <div className="pl-4">
            <VisibilityOptions value={visibility} onChange={onVisibilityChange} />
          </div>
        </div>
      )}

      {entityPermissions?.PUT && entityPermissions?.DELETE && (
        <hr className="my-6 border-tp-hairline-soft" />
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
