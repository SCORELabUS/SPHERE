import { Pricing } from 'pricing4ts';
import { motion } from 'framer-motion';
import { cardVariants } from '../../shared/motion-variants';

export default function PricingCard({
  pricing,
}: Readonly<{
  pricing: Pricing;
}>) {

  return (
    <motion.div variants={cardVariants} initial="hidden" animate="visible">
      <section className="mb-6 rounded-xl border border-tp-hairline bg-tp-canvas px-6 py-8 shadow-elevation-2">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-tp-ink sm:text-[34px]">
            {pricing?.saasName}
          </h1>

          <div className="mt-3 flex flex-wrap justify-center gap-6 text-sm text-tp-steel sm:gap-8">
            <span><span className='font-semibold text-tp-charcoal'>Plans:</span> {Object.values(pricing.plans ?? {}).length}</span>
            <span><span className='font-semibold text-tp-charcoal'>Add-ons:</span> {Object.values(pricing.addOns ?? {}).length || 0}</span>
          </div>
        </div>
      </section>
    </motion.div>
  );
}
