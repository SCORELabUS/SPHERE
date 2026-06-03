import { useState } from 'react';
import type { TreeAnalytics } from '../../types/card';

interface PricingTreeProps {
  analytics: TreeAnalytics;
}

export default function PricingTree({ analytics: a }: PricingTreeProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen(p => ({ ...p, [k]: !p[k] }));

  const Row = ({ label, count, unit, indent = 0 }: { label: string; count: number; unit?: string; indent?: number }) => (
    <div className={`flex items-center gap-2 py-1 text-xs ${indent ? 'pl-' + (indent * 4) : ''}`} style={{ paddingLeft: indent * 16 }}>
      <span className="flex-1 text-tp-slate">{label}</span>
      <span className="text-tp-steel">{count} {unit ?? (count === 1 ? label.toLowerCase().replace(/s$/, '') : label.toLowerCase())}</span>
    </div>
  );

  const Section = ({ label, count, unit, k, children }: { label: string; count: number; unit?: string; k: string; children?: React.ReactNode }) => (
    <div className="border-b border-tp-hairline-soft last:border-b-0">
      <button type="button" onClick={() => toggle(k)} className="flex w-full cursor-pointer items-center gap-2 py-1.5 text-xs font-medium text-tp-ink hover:text-tp-primary">
        <svg className={`h-3 w-3 shrink-0 text-tp-muted transition-transform ${open[k] ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        <span className="flex-1 text-left">{label}</span>
        <span className="text-[11px] font-normal text-tp-steel">{count} {unit ?? ''}</span>
      </button>
      {open[k] && children && <div className="pb-1 pl-4">{children}</div>}
    </div>
  );

  return (
    <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
      <h3 className="mb-2 text-xs font-medium text-tp-ink">Pricing</h3>
      <Section label="Plans" count={a.numberOfPlans} unit="plans" k="plans">
        <Row label="Free" count={a.numberOfFreePlans} unit="plan" indent={1} />
        <Row label="Paid" count={a.numberOfPaidPlans} unit="plans" indent={1} />
      </Section>
      <Section label="Features" count={a.numberOfFeatures} unit="features" k="features">
        <Row label="Automation" count={a.numberOfAutomationFeatures} indent={1} />
        {a.numberOfAutomationFeatures > 0 && <>
          <Row label="Bot" count={a.numberOfBotAutomationFeatures} indent={2} />
          <Row label="Filtering" count={a.numberOfFilteringAutomationFeatures} indent={2} />
          <Row label="Tracking" count={a.numberOfTrackingAutomationFeatures} indent={2} />
          <Row label="Task" count={a.numberOfTaskAutomationFeatures} indent={2} />
        </>}
        <Row label="Domain" count={a.numberOfDomainFeatures} indent={1} />
        <Row label="Guarantee" count={a.numberOfGuaranteeFeatures} indent={1} />
        <Row label="Information" count={a.numberOfInformationFeatures} indent={1} />
        <Row label="Integration" count={a.numberOfIntegrationFeatures} indent={1} />
        {a.numberOfIntegrationFeatures > 0 && <>
          <Row label="API" count={a.numberOfIntegrationApiFeatures} indent={2} />
          <Row label="Extension" count={a.numberOfIntegrationExtensionFeatures} indent={2} />
          <Row label="Identity Provider" count={a.numberOfIntegrationIdentityProviderFeatures} indent={2} />
          <Row label="Web SaaS" count={a.numberOfIntegrationWebSaaSFeatures} indent={2} />
          <Row label="Marketplace" count={a.numberOfIntegrationMarketplaceFeatures} indent={2} />
          <Row label="External Device" count={a.numberOfIntegrationExternalDeviceFeatures} indent={2} />
        </>}
        <Row label="Management" count={a.numberOfManagementFeatures} indent={1} />
        <Row label="Support" count={a.numberOfSupportFeatures} indent={1} />
        <Row label="Payment" count={a.numberOfPaymentFeatures} indent={1} />
      </Section>
      <Section label="Usage Limits" count={a.numberOfUsageLimits} unit="limits" k="limits">
        <Row label="Renewable" count={a.numberOfRenewableUsageLimits} indent={1} />
        <Row label="Non-Renewable" count={a.numberOfNonRenewableUsageLimits} indent={1} />
        <Row label="Response-Driven" count={a.numberOfResponseDrivenUsageLimits} indent={1} />
        <Row label="Time-Driven" count={a.numberOfTimeDrivenUsageLimits} indent={1} />
      </Section>
      <Section label="Add-Ons" count={a.numberOfAddOns} unit="add-ons" k="addons">
        <Row label="Singleton" count={a.numberOfReplacementAddons} indent={1} />
        <Row label="Usage-Based" count={a.numberOfExtensionAddons} indent={1} />
      </Section>
    </div>
  );
}
