import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Pricing, retrievePricingFromYaml } from 'pricing4ts';
import { usePricingsApi } from '../../api/pricingsApi';
import { useOrganizationsApi } from '../../../organization/api/organizationsApi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { useRecentItems } from '../../../core/hooks/useRecentItems';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import { downloadYaml, parseStringYamlToEncodedYaml } from '../../../pricing-editor/services/export.service';
import ConfigurationSpaceView from '../../components/configuration-space-view';
import VisibilityOptions from '../../components/visibility-options';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import { transitionDefault } from '../../../core/utils/motion-variants';
import customConfirm from '../../../core/utils/custom-confirm';
import customAlert from '../../../core/utils/custom-alert';
import Iconify from '../../../core/components/iconify';
import DatePicker from '../../../core/components/date-picker';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EntityPermissions } from '../../../organization/types/permissions';
import PricingCardSkeleton from '../../../core/components/skeletons/pricing-card-skeleton';

const axisTick = { fill: '#4a4a4a', fontSize: 11 };
const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmtY = (v: number) => { if (!Number.isFinite(v)) return ''; return Math.abs(v) >= 1000 ? compactNum.format(v) : String(v); };

interface VersionData {
  id: string;
  version: string;
  createdAt: string;
  yaml: string;
  private: boolean;
  collection: { id: string; name: string; slug: string } | null;
  analytics: Record<string, number> | null;
}

type Tab = 'overview' | 'analytics' | 'config-space' | 'versions' | 'settings';

interface TreeAnalytics {
  numberOfPlans: number; numberOfFeatures: number; numberOfAddOns: number; numberOfUsageLimits: number;
  numberOfFreePlans: number; numberOfPaidPlans: number;
  numberOfDomainFeatures: number; numberOfAutomationFeatures: number; numberOfIntegrationFeatures: number;
  numberOfInformationFeatures: number; numberOfManagementFeatures: number; numberOfGuaranteeFeatures: number;
  numberOfSupportFeatures: number; numberOfPaymentFeatures: number;
  numberOfIntegrationApiFeatures: number; numberOfIntegrationExtensionFeatures: number;
  numberOfIntegrationIdentityProviderFeatures: number; numberOfIntegrationWebSaaSFeatures: number;
  numberOfIntegrationMarketplaceFeatures: number; numberOfIntegrationExternalDeviceFeatures: number;
  numberOfRenewableUsageLimits: number; numberOfNonRenewableUsageLimits: number;
  numberOfResponseDrivenUsageLimits: number; numberOfTimeDrivenUsageLimits: number;
  numberOfReplacementAddons: number; numberOfExtensionAddons: number;
  numberOfBotAutomationFeatures: number; numberOfFilteringAutomationFeatures: number;
  numberOfTrackingAutomationFeatures: number; numberOfTaskAutomationFeatures: number;
}

function PricingTree({ analytics: a }: { analytics: TreeAnalytics }) {
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

export default function CardPage() {
  const { organizationId, name } = useParams<{ organizationId: string; name: string }>();
  const [searchParams] = useSearchParams();
  const collectionSlug = searchParams.get('collectionSlug');
  const router = useRouter();
  const { getPricingByName, removePricingVersion, removePricingByName, updatePricing } = usePricingsApi();
  const { getOrgMembers } = useOrganizationsApi();
  const { authUser } = useAuth();
  const { addRecentPricing } = useRecentItems();

  const [versions, setVersions] = useState<VersionData[]>([]);
  const [currentVersion, setCurrentVersion] = useState<VersionData | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [yamlText, setYamlText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingYaml, setIsLoadingYaml] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [canDelete, setCanDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [entityPermissions, setEntityPermissions] = useState<EntityPermissions | null>(null);
  const [visibility, setVisibility] = useState('Public');

  // Fetch versions + check permissions
  useEffect(() => {
    if (!name || !organizationId) return;
    setIsLoading(true);
    getPricingByName(name, organizationId, collectionSlug)
      .then(async (data) => {
        const vers = (data.versions ?? []) as VersionData[];
        setVersions(vers);
        if (vers.length > 0) {
          setCurrentVersion(vers[0]);
          setVisibility(vers[0].private ? 'Private' : 'Public');
        }
        // Check if user can delete (OWNER or ADMIN of org)
        try {
          const members = await getOrgMembers(organizationId);
          const me = members.find((m: any) => m.user.username === authUser.user?.username);
          setCanDelete(me ? (me.role === 'OWNER' || me.role === 'ADMIN') : false);
        } catch { setCanDelete(false); }

        // Fetch entity permissions
        try {
          const baseUrl = import.meta.env.VITE_API_URL;
          const token = authUser?.token;
          const response = await fetch(`${baseUrl}/pricings/${organizationId}/${name}/permissions`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data: EntityPermissions = await response.json();
            setEntityPermissions(data);
          }
        } catch { setEntityPermissions(null); }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [name, organizationId, collectionSlug]);

  // Track visit for recent items
  useEffect(() => {
    if (!authUser.isAuthenticated || !name || !organizationId) return;
    addRecentPricing({
      id: `${organizationId}/${name}`,
      name,
      orgId: organizationId,
      orgName: organizationId,
    });
  }, [name, organizationId, authUser.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch YAML when version changes
  useEffect(() => {
    if (!currentVersion?.yaml) return;
    setIsLoadingYaml(true);
    setErrors([]);
    const url = currentVersion.yaml.startsWith('http') ? currentVersion.yaml : `${import.meta.env.VITE_API_URL}${currentVersion.yaml}`;
    fetch(url)
      .then(r => r.text())
      .then(async text => {
        setYamlText(text);
        try {
          setPricing(retrievePricingFromYaml(text));
        } catch {
          // Non-3.1 YAML: upgrade via API
          try {
            const response = await fetch('/api/v1/pricings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pricing: text }),
            });
            if (!response.ok) throw new Error('Failed to parse pricing');
            setPricing(await response.json());
            setErrors([]);
          } catch (err) {
            setErrors([(err as Error).message]);
            setPricing(null);
          }
        }
      })
      .catch(() => { setYamlText(''); setPricing(null); })
      .finally(() => setIsLoadingYaml(false));
  }, [currentVersion]);

  const handleApplyVariables = async (variables: Record<string, unknown>) => {
    if (!yamlText) return;
    try {
      const ser = (v: unknown) => { if (typeof v === 'string') return JSON.stringify(v); if (typeof v === 'boolean') return v ? 'true' : 'false'; if (typeof v === 'number' && Number.isFinite(v)) return String(v); return JSON.stringify(v); };
      const lines = ['variables:']; for (const k of Object.keys(variables)) lines.push(`  ${k}: ${ser(variables[k])}`);
      const block = lines.join('\n');
      const re = /^variables:\n(?:[ \t]+.+\n?)*/gm;
      const newYaml = re.test(yamlText) ? yamlText.replace(re, block + '\n') : yamlText + '\n' + block + '\n';
      setYamlText(newYaml);
      try {
        setPricing(retrievePricingFromYaml(newYaml));
        setErrors([]);
      } catch {
        const response = await fetch('/api/v1/pricings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pricing: newYaml }),
        });
        if (!response.ok) throw new Error('Failed to parse pricing');
        setPricing(await response.json());
        setErrors([]);
      }
    } catch (e) { setErrors([(e as Error).message]); }
  };

  // Filtered versions by date range
  const filteredVersions = useMemo(() => {
    let list = versions;
    if (dateFrom) list = list.filter(v => v.createdAt >= dateFrom);
    if (dateTo) list = list.filter(v => v.createdAt <= dateTo + 'T23:59:59');
    return list;
  }, [versions, dateFrom, dateTo]);

  // Chart data from filtered versions
  const chartData = useMemo(() =>
    filteredVersions.slice().reverse().map(v => ({
      date: new Date(v.createdAt).toLocaleDateString(),
      minPrice: v.analytics?.minSubscriptionPrice ?? 0,
      maxPrice: v.analytics?.maxSubscriptionPrice ?? 0,
      avgPrice: v.analytics ? (v.analytics.minSubscriptionPrice + v.analytics.maxSubscriptionPrice) / 2 : 0,
      configs: v.analytics?.configurationSpaceSize ?? 0,
      plans: v.analytics?.numberOfPlans ?? 0,
      features: v.analytics?.numberOfFeatures ?? 0,
      addOns: v.analytics?.numberOfAddOns ?? 0,
      usageLimits: v.analytics?.numberOfUsageLimits ?? 0,
    })), [filteredVersions]);

  const a = currentVersion?.analytics ?? null;
  const aSafe = a ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) as unknown as TreeAnalytics : null;
  const symbol = currentVersion ? '$' : '$';

  const handleDownload = (v: VersionData) => {
    const url = v.yaml.startsWith('http') ? v.yaml : `${import.meta.env.VITE_API_URL}${v.yaml}`;
    fetch(url).then(r => r.text()).then(text => downloadYaml(text)).catch(() => {});
  };

  const handleOpenInEditor = (v: VersionData) => {
    const url = v.yaml.startsWith('http') ? v.yaml : `${import.meta.env.VITE_API_URL}${v.yaml}`;
    fetch(url).then(r => r.text()).then(text => {
      const encoded = parseStringYamlToEncodedYaml(text);
      window.open(`/editor?pricing=${encoded}`, '_blank');
    }).catch(() => {});
  };

  const handleCopyLink = (v: VersionData) => {
    const yamlUrl = v.yaml.startsWith('http') ? v.yaml : `${import.meta.env.VITE_API_URL}${v.yaml}`;
    setLinkUrl(yamlUrl);
    setShowLinkModal(true);
  };

  const handleDelete = async (v: VersionData) => {
    if (!name) return;
    if (!confirm(`Delete version ${v.version}? This cannot be undone.`)) return;
    try {
      await removePricingVersion(name, v.version);
      setVersions(prev => prev.filter(x => x.id !== v.id));
      if (currentVersion?.id === v.id) setCurrentVersion(versions.find(x => x.id !== v.id) ?? null);
    } catch {
      console.error("Failed to delete version");
    }
  };

  const handleVisibilityChange = () => {
    if (!name) return;
    customConfirm('Are you sure you want to change the visibility of this pricing?', { danger: true })
      .then(() => {
        const pricingUpdateBody = { private: visibility === 'Public' }; // We check the oposite cause the visibility state has not yet being changed
        updatePricing(organizationId!, name, collectionSlug ?? '', pricingUpdateBody)
          .then(() => {
            setVisibility(visibility === 'Private' ? 'Public' : 'Private');
            customAlert('Pricing visibility updated successfully', 'success');
          })
          .catch((error: Error) => {
            customAlert(`Error: ${error.message}`, 'error');
          });
      })
      .catch(() => {});
  };

  const handleDeletePricing = () => {
    if (!name) return;
    customConfirm('Are you sure you want to delete this pricing? This action is irreversible.', { danger: true })
      .then(() => {
        if (!organizationId) {
          customAlert('Organization ID is missing. Cannot delete pricing.', 'error');
          return;
        }
        removePricingByName(organizationId, name, collectionSlug ?? undefined)
          .then(() => {
            customConfirm('Pricing deleted successfully. Do you want to return to the main page?', { danger: false })
              .then(() => router.push('/'))
              .catch(() => router.push('/pricings'));
          })
          .catch(() => {
            customAlert('An error has occurred while removing the pricing. Please, try again later.', 'error');
          });
      })
      .catch(() => {});
  };

  const showSettingsTab = entityPermissions?.PUT || entityPermissions?.DELETE;

  if (isLoading) return <PricingCardSkeleton />;

  return (
    <>
      <Helmet><title>SPHERE - {name}</title></Helmet>
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        {/* Breadcrumb + header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transitionDefault} className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs text-tp-steel">
            <button type="button" onClick={() => router.push('/pricings')} className="cursor-pointer hover:text-tp-ink">Pricings</button>
            <span>/</span>
            {collectionSlug && <><button type="button" onClick={() => router.push('/collections')} className="cursor-pointer hover:text-tp-ink">{collectionSlug}</button><span>/</span></>}
            <span className="text-tp-ink">{name}</span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-normal text-tp-ink">{name}</h1>
              {currentVersion && <p className="mt-1 text-sm text-tp-steel">Updated {formatDistanceToNow(parseISO(currentVersion.createdAt))} ago</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Version selector */}
              {versions.length > 1 && (
                <select value={currentVersion?.id ?? ''} onChange={e => { const v = versions.find(x => x.id === e.target.value); if (v) setCurrentVersion(v); }}
                  className="h-8 cursor-pointer rounded-lg border border-tp-input-border bg-tp-input-bg px-2 text-xs text-tp-ink focus:border-tp-primary focus:outline-none">
                  {versions.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                </select>
              )}
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transitionDefault, delay: 0.05 }} className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ l: 'Configurations', v: a?.configurationSpaceSize?.toLocaleString() ?? '—' }, { l: 'Min price', v: a ? `${symbol}${a.minSubscriptionPrice.toFixed(2)}` : '—' }, { l: 'Max price', v: a ? `${symbol}${a.maxSubscriptionPrice.toFixed(2)}` : '—' }, { l: 'Versions', v: String(versions.length) }].map(s => (
            <div key={s.l} className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-3"><p className="text-[11px] text-tp-steel">{s.l}</p><p className="mt-0.5 text-lg font-semibold text-tp-ink">{s.v}</p></div>
          ))}
        </motion.div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-tp-hairline-soft">
          {([
            ['overview', 'Overview'],
            ['analytics', 'Analytics'],
            ['config-space', 'Configuration Space'],
            ['versions', 'Versions'],
            ...(showSettingsTab ? [['settings', 'Settings'] as const] : []),
          ] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`relative cursor-pointer whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${tab === k ? 'text-tp-primary' : 'text-tp-steel hover:text-tp-ink'}`}>
              {l}
              {tab === k && <motion.div layoutId="pricing-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-tp-primary" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ═══ OVERVIEW ═══ */}
          {tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
                <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
                  {isLoadingYaml ? <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" /></div>
                    : pricing ? <PricingRenderer pricing={pricing} errors={errors} onApplyVariables={handleApplyVariables} />
                    : <div className="flex h-64 items-center justify-center text-sm text-tp-steel">Could not load pricing preview</div>}
                </div>
                <div className="space-y-4">
                  {aSafe && <PricingTree analytics={aSafe} />}
                  {yamlText && <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4"><h3 className="mb-3 text-xs font-medium text-tp-ink">YAML source</h3><pre className="max-h-125 overflow-auto rounded-lg bg-tp-surface-code p-3 text-[11px] leading-relaxed text-tp-on-dark">{yamlText}</pre></div>}
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ ANALYTICS ═══ */}
          {tab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium text-tp-ink">Analytics</h3>
                <DatePicker dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
              </div>
              {chartData.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Price evolution — half row */}
                  <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
                    <div className="mb-3 flex items-center justify-center gap-4 text-[11px]">
                      <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-[#2563eb]" />Min price</span>
                      <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-[#dc2626]" />Max price</span>
                    </div>
                    <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#ededed" /><XAxis dataKey="date" tick={axisTick} /><YAxis tick={axisTick} tickFormatter={fmtY} width={50} domain={['auto', 'auto']} /><Tooltip /><Line type="monotone" dataKey="minPrice" name="Min" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} /><Line type="monotone" dataKey="maxPrice" name="Max" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
                  </div>
                  {/* Series cards */}
                  {([['configs', 'Configuration Space', '#08aeb3', 'configs'], ['plans', 'Plans', '#7c3aed', 'plans'], ['features', 'Features', '#0891b2', 'features'], ['addOns', 'Add-Ons', '#16a34a', 'addOns'], ['usageLimits', 'Usage Limits', '#ea580c', 'usageLimits']] as const).map(([k, label, color, dk]) => (
                    <div key={k} className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
                      <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-tp-ink"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</div>
                      <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#ededed" /><XAxis dataKey="date" tick={axisTick} /><YAxis tick={axisTick} tickFormatter={fmtY} width={50} domain={['auto', 'auto']} /><Tooltip /><Line type="monotone" dataKey={dk} stroke={color} strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
                    </div>
                  ))}
                </div>
              ) : <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-16 text-center"><p className="text-sm text-tp-steel">No data available for the selected date range.</p></div>}
            </motion.div>
          )}

          {/* ═══ CONFIGURATION SPACE ═══ */}
          {tab === 'config-space' && (
            <motion.div key="config-space" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              {a && a.configurationSpaceSize && a.configurationSpaceSize > 2000 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-16 text-center">
                  <svg className="mb-3 h-10 w-10 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  <p className="text-sm font-medium text-tp-ink">Configuration space too large</p>
                  <p className="mt-1 max-w-md text-xs text-tp-steel">This pricing has {a.configurationSpaceSize.toLocaleString()} configurations. The explorer is only available for pricing with ≤2,000 configurations.</p>
                </div>
              ) : organizationId && currentVersion ? (
                <ConfigurationSpaceView organizationId={organizationId} pricingName={name!} pricingVersion={currentVersion.version} />
              ) : null}
            </motion.div>
          )}

          {/* ═══ VERSIONS ═══ */}
          {tab === 'versions' && (
            <motion.div key="versions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas">
                <div className="divide-y divide-tp-hairline-soft">
                  {versions.map(v => (
                    <div key={v.id} className={`flex flex-col gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${v.id === currentVersion?.id ? 'bg-tp-primary/5' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-tp-ink">{v.version}</span>
                        {v.id === currentVersion?.id && <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-medium text-tp-primary">Current</span>}
                        {v.private && <span className="rounded-full bg-tp-surface px-2 py-0.5 text-[10px] font-medium text-tp-steel">Private</span>}
                        <span className="text-[11px] text-tp-steel">{formatDistanceToNow(parseISO(v.createdAt))} ago</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleDownload(v)} title="Download YAML" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></button>
                        <button type="button" onClick={() => handleOpenInEditor(v)} title="Open in editor" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg></button>
                        <button type="button" onClick={() => handleCopyLink(v)} title="Copy link" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg></button>
                        {canDelete && <button type="button" onClick={() => handleDelete(v)} title="Delete version" className="cursor-pointer rounded-md p-1.5 text-tp-steel transition-colors hover:bg-red-50 hover:text-red-500"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ SETTINGS ═══ */}
          {tab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-5">
                {entityPermissions?.PUT && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-tp-ink">Visibility</h3>
                    <div className="pl-4">
                      <VisibilityOptions value={visibility} onChange={handleVisibilityChange} />
                    </div>
                  </div>
                )}

                {entityPermissions?.PUT && entityPermissions?.DELETE && (
                  <hr className="my-6 border-tp-hairline-soft" />
                )}

                {entityPermissions?.DELETE && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-red-500">Danger Zone</h3>
                    <div className="rounded-lg border border-red-500 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-tp-ink">Delete this pricing</p>
                          <p className="mt-1 text-xs text-tp-steel">Once you delete a pricing, there is no going back. Please be certain.</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleDeletePricing}
                          className="cursor-pointer rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-500 hover:text-white"
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ LINK MODAL ═══ */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/40 p-4" onClick={() => { setShowLinkModal(false); setCopied(false); }}>
          <div className="w-[90vw] max-w-150 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-center text-xl font-bold text-tp-ink">Your link is ready!</h2>
            <p className="mt-2 text-center text-sm text-tp-steel">This link points directly to the YAML file of the selected pricing version. It can be used to integrate with some <a href="https://sphere-docs.vercel.app" target="_blank" rel="noopener noreferrer" className="cursor-pointer underline">Pricing Intelligence tools</a>.</p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-surface p-2">
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-xs text-tp-ink">{linkUrl}</p>
              </div>
              <motion.button
                type="button"
                onClick={() => { navigator.clipboard.writeText(linkUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                animate={{ backgroundColor: copied ? '#22c55e' : undefined }}
                transition={{ duration: 0.2 }}
                className="cursor-pointer shrink-0 rounded-md bg-tp-primary p-2 text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
              >
                <AnimatePresence mode="wait">
                  {copied ? (
                    <motion.svg key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }} className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></motion.svg>
                  ) : (
                    <motion.svg key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }} className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></motion.svg>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
            <div className="mt-4 text-center"><button type="button" onClick={() => { setShowLinkModal(false); setCopied(false); }} className="cursor-pointer text-xs text-tp-steel hover:text-tp-ink">Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
