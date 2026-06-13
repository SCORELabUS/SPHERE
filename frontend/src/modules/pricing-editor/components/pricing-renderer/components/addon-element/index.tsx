import { AddOn } from 'pricing4ts';
import { formatPricingComponentName } from '../../../../services/pricing.service';
import { motion } from 'framer-motion';
import { cardVariants } from '../../shared/motion-variants';
import { indexFromString } from '../../shared/color-palette';
import { formatMoneyDisplay } from '../../shared/value-helpers';

const ACCENT_COLORS = [
  'bg-tp-primary',
  'bg-tp-sunshine-700',
  'bg-tp-sunshine-900',
  'bg-tp-primary-deep',
];

const ICON_BG_CLASSES = [
  'bg-orange-100 text-tp-primary',
  'bg-amber-100 text-amber-700',
  'bg-teal-100 text-teal-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-pink-100 text-pink-700',
  'bg-emerald-100 text-emerald-700',
  'bg-red-100 text-red-700',
  'bg-yellow-100 text-yellow-700',
];

export default function AddOnElement({
  addOn,
  currency,
}: Readonly<{
  addOn: AddOn;
  currency: string;
}>): JSX.Element {
  const idx = indexFromString(addOn.name);
  const accentClass = ACCENT_COLORS[idx % ACCENT_COLORS.length];
  const iconClass = ICON_BG_CLASSES[idx % ICON_BG_CLASSES.length];

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}
      className={`relative overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas shadow-elevation-1 transition-shadow`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />

      <div className="flex flex-col gap-3 p-5 pl-6">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${iconClass}`}>
            {formatPricingComponentName(addOn.name).charAt(0)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-tp-ink" title={formatPricingComponentName(addOn.name)}>
              {formatPricingComponentName(addOn.name)}
            </div>
            {addOn.description && (
              <div className="mt-0.5 truncate text-xs text-tp-steel" title={addOn.description}>
                {addOn.description}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="inline-flex items-center rounded-full bg-tp-primary px-3 py-1 text-sm font-bold text-tp-on-primary">
            {formatMoneyDisplay(addOn.price)}{typeof addOn.price === 'number' ? currency : ''}
          </span>
          {typeof addOn.price === 'number' && (
            <span className="text-xs text-tp-steel">
              {addOn.unit ? addOn.unit : '/month'}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
