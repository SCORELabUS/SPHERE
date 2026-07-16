import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Pricing, retrievePricingFromYaml } from 'pricing4ts';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import LoadingView from '../../../core/pages/loading';

export default function PricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/pricing/SPHERE.yml')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load pricing');
        return res.text();
      })
      .then(yaml => {
        const parsed = retrievePricingFromYaml(yaml);
        setPricing(parsed);
        setIsLoading(false);
      })
      .catch(() => {
        setErrors(['Failed to load SPHERE pricing.']);
        setIsLoading(false);
      });
  }, []);

  if (isLoading) return <LoadingView />;

  return (
    <>
      <Helmet>
        <title>SPHERE - Pricing</title>
      </Helmet>
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-tp-ink sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-lg text-tp-slate">
            Choose the plan that fits your needs
          </p>
        </div>

        <div className="mb-8 rounded-lg border border-tp-severity-warning-border bg-tp-severity-warning-bg px-5 py-4 text-sm text-tp-severity-warning">
          <p>
            <span className="font-bold">TENTATIVE PRICING – </span> SPHERE is currently a prototype. The plans and prices shown below are preliminary and subject to change. They do not represent binding commitments or final pricing. Formal pricing will take effect in a future release.
          </p>
        </div>

        {errors.length > 0 && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}

        {pricing && <PricingRenderer pricing={pricing} errors={errors} />}
      </div>
    </>
  );
}
