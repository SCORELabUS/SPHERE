import { Configuration } from '../configuration-space-view';
import { FaCircleCheck } from 'react-icons/fa6';
import { success } from '../../../core/theme/palette';
import { formatPricingComponentName } from '../../../pricing-editor/services/pricing.service';

export default function ConfigurationSpaceItem({
  configuration,
  onClick,
}: {
  configuration: Configuration;
  onClick: (configuration: Configuration) => void;
}) {
  return (
    <div
      className="cursor-pointer rounded-lg border border-slate-200 shadow-sm transition-shadow hover:shadow-[0_0_0_2px_rgb(0,0,0)]"
      onClick={() => onClick(configuration)}
    >
      <div className="p-4">
        <h3 className="text-2xl font-semibold">
          {configuration.selectedPlan}
        </h3>
        {configuration.selectedAddons.length > 0 && (
          <ul className="mt-2 space-y-1">
            {configuration.selectedAddons.map((addon, j) => (
              <li key={j} className="flex items-center">
                <span className="mr-2 flex items-center justify-center">
                  <FaCircleCheck fill={success.light} />
                </span>
                <span>{formatPricingComponentName(addon)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
