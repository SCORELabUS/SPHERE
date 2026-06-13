import { Configuration } from '../configuration-space-view';
import { formatPricingComponentName } from '../../../pricing-editor/services/pricing.service';
import FlagGrid from './components/elem-flags';

export default function ConfigurationDetailsModal({
  configuration,
  isOpen,
  handleClose,
}: Readonly<{
  configuration: Configuration | undefined;
  isOpen: boolean;
  handleClose: () => void;
}>) {
  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50 cursor-pointer bg-black/45 p-4" onClick={handleClose}>
          <div
            className="absolute left-1/2 top-1/2 flex h-[90dvh] w-[90%] max-w-[1200px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-white p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {configuration?.selectedPlan && (
              <div className="my-4 ml-4">
                <h2 className="text-center text-4xl font-semibold">
                  Plan <strong>{configuration?.selectedPlan}</strong>
                </h2>
              </div>
            )}

            {configuration?.selectedAddons && configuration?.selectedAddons.length > 0 && (
              <div className="my-4 ml-4">
                <h2 className="text-center text-4xl font-bold">Add-ons</h2>

                <FlagGrid
                  data={configuration.selectedAddons.map(addon => formatPricingComponentName(addon))}
                />
              </div>
            )}

            {configuration?.subscriptionFeatures &&
              configuration?.subscriptionFeatures.length > 0 && (
                <div className="my-4 ml-4">
                  <h2 className="text-center text-4xl font-bold">Features</h2>

                  <FlagGrid
                    data={configuration.subscriptionFeatures.map(addon =>
                      formatPricingComponentName(addon)
                    )}
                  />
                </div>
              )}
          </div>
        </div>
      )}
    </>
  );
}
