import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Pricing, retrievePricingFromYaml } from 'pricing4ts';
import { usePricingsApi } from '../../api/pricingsApi';
import { useOrganizationsApi, getPublicOrganization } from '../../../organization/api/organizationsApi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { useRecentItems } from '../../../core/hooks/useRecentItems';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import { downloadYaml, parseStringYamlToEncodedYaml } from '../../../pricing-editor/services/export.service';
import ConfigurationSpaceView from '../../components/configuration-space-view';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import { transitionDefault } from '../../../core/utils/motion-variants';
import customConfirm from '../../../core/utils/custom-confirm';
import customAlert from '../../../core/utils/custom-alert';
import { formatDistanceToNow, parseISO } from 'date-fns';
import PricingCardSkeleton from '../../../core/components/skeletons/pricing-card-skeleton';
import PrivateAccessFallback from '../../components/private-access-fallback';
import HarveyChat from '../../../core/components/harvey-chat';
import type { SuggestedQuestion } from '../../../core/components/harvey-chat';
import type { EntityPermissions } from '../../../organization/types/permissions';
import YamlSourcePanel from '../../components/yaml-source-panel';
import PricingTree from '../../components/pricing-tree';
import PricingAnalyticsTab from '../../components/pricing-analytics-tab';
import PricingVersionsTab from '../../components/pricing-versions-tab';
import PricingSettingsTab from '../../components/pricing-settings-tab';
import PricingLinkModal from '../../components/pricing-link-modal';
import PricingImportModal from '../../components/pricing-import-modal';
import type { VersionData, Tab, TreeAnalytics } from '../../types/card';

export default function CardPage() {
  const { organizationId, slug } = useParams<{ organizationId: string; slug: string }>();
  const [searchParams] = useSearchParams();
  const collectionSlug = searchParams.get('collection');
  const router = useRouter();
  const { getPricingBySlug, removePricingVersion, removePricingBySlug, updatePricing, createPricingVersion } = usePricingsApi();
  const { getOrgMembers } = useOrganizationsApi();
  const { authUser } = useAuth();
  const { addRecentPricing } = useRecentItems();

  const [versions, setVersions] = useState<VersionData[]>([]);
  const [currentVersion, setCurrentVersion] = useState<VersionData | null>(null);
  const [pricing, setPricing] = useState<Pricing & {name?: string} | null>(null);
  const [pricingName, setPricingName] = useState<string>('');
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
  const [entityPermissions, setEntityPermissions] = useState<EntityPermissions | null>(null);
  const [visibility, setVisibility] = useState('Public');
  const [orgDisplayName, setOrgDisplayName] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    getPublicOrganization(organizationId)
      .then(org => setOrgDisplayName(org.displayName || org.name))
      .catch(() => setOrgDisplayName(null));
  }, [organizationId]);

  useEffect(() => {
    if (!slug || !organizationId) return;
    setIsLoading(true);
    getPricingBySlug(slug, organizationId, collectionSlug)
      .then(async (data) => {
        setPricingName(data.name ?? slug);
        setCollectionName(data.collection?.name ?? null);
        const vers = (data.versions ?? []) as VersionData[];
        setVersions(vers);
        if (vers.length > 0) {
          setCurrentVersion(vers[0]);
          setVisibility(vers[0].private ? 'Private' : 'Public');
        }
        try {
          const members = await getOrgMembers(organizationId);
          const me = members.find((m: any) => m.user.username === authUser.user?.username);
          setCanDelete(me ? (me.role === 'OWNER' || me.role === 'ADMIN') : false);
        } catch { setCanDelete(false); }

        try {
          const baseUrl = import.meta.env.VITE_API_URL;
          const token = authUser?.token;
          const response = await fetch(`${baseUrl}/pricings/${organizationId}/${slug}/permissions`, {
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
  }, [slug, organizationId, collectionSlug]);

  useEffect(() => {
    if (!authUser.isAuthenticated || !slug || !organizationId) return;
    addRecentPricing({
      id: `${organizationId}/${slug}`,
      name: slug,
      orgId: organizationId,
      orgName: organizationId,
    });
  }, [slug, organizationId, authUser.isAuthenticated]);

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

  const filteredVersions = useMemo(() => {
    let list = versions;
    if (dateFrom) list = list.filter(v => v.createdAt >= dateFrom);
    if (dateTo) list = list.filter(v => v.createdAt <= dateTo + 'T23:59:59');
    return list;
  }, [versions, dateFrom, dateTo]);

  const chartData = useMemo(() => {
    const entries = filteredVersions.slice().reverse();
    const data = entries.map(v => ({
      date: new Date(v.createdAt).toLocaleDateString(),
      minPrice: v.analytics?.minSubscriptionPrice ?? 0,
      maxPrice: v.analytics?.maxSubscriptionPrice ?? 0,
      avgPrice: v.analytics ? (v.analytics.minSubscriptionPrice + v.analytics.maxSubscriptionPrice) / 2 : 0,
      configs: v.analytics?.configurationSpaceSize ?? 0,
      plans: v.analytics?.numberOfPlans ?? 0,
      features: v.analytics?.numberOfFeatures ?? 0,
      addOns: v.analytics?.numberOfAddOns ?? 0,
      usageLimits: v.analytics?.numberOfUsageLimits ?? 0,
    }));
    if (entries.length > 0) {
      const firstDate = new Date(entries[0].createdAt);
      const zeroDate = new Date(firstDate);
      zeroDate.setHours(zeroDate.getHours() - 24);
      data.unshift({
        date: zeroDate.toLocaleDateString(),
        minPrice: 0,
        maxPrice: 0,
        avgPrice: 0,
        configs: 0,
        plans: 0,
        features: 0,
        addOns: 0,
        usageLimits: 0,
      });
    }
    return data;
  }, [filteredVersions]);

  const a = currentVersion?.analytics ?? null;
  const aSafe = a ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'number' ? v : 0])) as unknown as TreeAnalytics : null;

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
    if (!slug) return;
    if (!confirm(`Delete version ${v.version}? This cannot be undone.`)) return;
    try {
      await removePricingBySlug(organizationId || "", slug, collectionSlug ?? undefined);
      setVersions(prev => prev.filter(x => x.id !== v.id));
      if (currentVersion?.id === v.id) setCurrentVersion(versions.find(x => x.id !== v.id) ?? null);
    } catch {
      console.error("Failed to delete version");
    }
  };

  const handleVisibilityChange = () => {
    if (!slug) return;
    customConfirm('Are you sure you want to change the visibility of this pricing?', { danger: true })
      .then(() => {
        const pricingUpdateBody = { private: visibility === 'Public' };
        updatePricing(organizationId!, slug, collectionSlug ?? '', pricingUpdateBody)
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

  const handleRename = (newName: string) => {
    if (!slug) return;
    customConfirm(
      `Are you sure you want to rename this pricing to "${newName}"? You'll be redirected to the new URL.`,
      { danger: false }
    ).then(() => {
      updatePricing(organizationId!, slug, collectionSlug ?? '', { name: newName })
        .then((data: any) => {
          if (data?.error) {
            customAlert(`Error: ${data.error}`, 'error');
            return;
          }
          const newSlug = data?.slug ?? slug;
          setPricingName(newName);
          customAlert('Pricing renamed successfully', 'success');
          if (newSlug !== slug) {
            router.push(`/pricings/${organizationId}/${newSlug}${collectionSlug ? `?collectionSlug=${collectionSlug}` : ''}`);
          }
        })
        .catch((error: Error) => {
          customAlert(`Error: ${error.message}`, 'error');
        });
    }).catch(() => {});
  };

  const handleDeleteCurrentVersion = () => {
    if (!slug || !currentVersion) return;
    customConfirm(`Are you sure you want to delete version ${currentVersion.version}? This action is irreversible.`, { danger: true })
      .then(() => {
        removePricingVersion(organizationId || "", slug, currentVersion.version)
          .then(() => {
            setVersions(prev => {
              const next = prev.filter(x => x.id !== currentVersion.id);
              if (next.length > 0) setCurrentVersion(next[0]);
              else setCurrentVersion(null);
              return next;
            });
            customAlert(`Version ${currentVersion.version} deleted successfully`, 'success');
          })
          .catch(() => {
            customAlert('An error has occurred while deleting the version. Please, try again later.', 'error');
          });
      })
      .catch(() => {});
  };

  const handleDeletePricing = () => {
    if (!slug) return;
    customConfirm('Are you sure you want to delete this pricing? This action is irreversible.', { danger: true })
      .then(() => {
        if (!organizationId) {
          customAlert('Organization ID is missing. Cannot delete pricing.', 'error');
          return;
        }
        removePricingBySlug(organizationId, slug, collectionSlug ?? undefined)
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

  const handleImportVersion = async (file: File) => {
    if (!slug || !organizationId) return;

    try {
      const text = await file.text();
      let uploadedPricing: Pricing;
      try {
        uploadedPricing = retrievePricingFromYaml(text);
      } catch {
        customAlert('The uploaded file is not a valid Pricing2Yaml file.', 'error');
        return;
      }

      const versionExists = versions.some(v => v.version === uploadedPricing.version);
      if (versionExists) {
        customAlert(`Version "${uploadedPricing.version}" already exists. Please upload a file with a different version.`, 'error');
        return;
      }

      if (uploadedPricing.saasName !== pricing?.name){
        customConfirm(`The uploaded pricing is named "${uploadedPricing.saasName}", which does not match the current pricing name "${pricing?.name}". Do you want to proceed?`, { danger: true })
          .then(() => {
            _createPricingVersion(file, organizationId, slug, uploadedPricing.version);
          })
      }else{
        _createPricingVersion(file, organizationId, slug, uploadedPricing.version);
      }
    } catch (err) {
      customAlert(`Error adding version: ${(err as Error).message}`, 'error');
    }
  };

  async function _createPricingVersion(file: File, organizationId: string, slug: string, version: string) {
    const formData = new FormData();
      formData.append('yaml', file);
      formData.append('private', 'false');

      await createPricingVersion(formData, organizationId, slug, version);
      customAlert('New version added successfully', 'success');
      setShowImportModal(false);

      getPricingBySlug(slug, organizationId, collectionSlug).then(async (data) => {
        const vers = (data.versions ?? []) as VersionData[];
        setVersions(vers);
        if (vers.length > 0) {
          setCurrentVersion(vers[0]);
        }
      });
  }

  const showSettingsTab = entityPermissions?.PUT || entityPermissions?.DELETE;
  const isPrivateNoAccess = !entityPermissions?.GET && !currentVersion;

  const pricingSuggestions: SuggestedQuestion[] = useMemo(() => {
    if (!a) return [
      { id: 'overview', label: 'Give me an overview of this pricing', question: 'Can you give me an overview of this pricing structure? What are the main plans and features?' },
      { id: 'compare', label: 'Compare plans and their differences', question: 'What are the differences between the available plans? Which one offers the best value?' },
      { id: 'optimize', label: 'Suggest improvements for this pricing', question: 'Do you see any opportunities to improve this pricing strategy? Any redundancies or gaps?' },
    ];
    return [
      { id: 'cheapest', label: `Find the cheapest plan with the most features`, question: `Which is the most affordable configuration that includes the maximum number of features in ${pricingName}?` },
      { id: 'compare', label: 'Compare all plans side by side', question: `Can you compare all the plans in ${pricingName}? What are the key differences and which offers the best value?` },
      { id: 'gaps', label: 'Identify gaps in the pricing strategy', question: `Are there any gaps or missing tiers in the ${pricingName} pricing? Could there be a plan that captures users between tiers?` },
      { id: 'redundancies', label: 'Check for redundant plans or features', question: `Are there any redundant plans or overlapping features in ${pricingName}? How could the pricing be streamlined?` },
    ];
  }, [a, pricingName]);

  if (isLoading) return <PricingCardSkeleton />;

  return (
    <>
      <Helmet><title>SPHERE - {pricingName}</title></Helmet>
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        {/* Breadcrumb + header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transitionDefault} className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs text-tp-steel">
            <button type="button" onClick={() => router.push(`/orgs/${organizationId}`)} className="cursor-pointer hover:text-tp-ink">
              {orgDisplayName || 'Organization'}
            </button>
            <span>/</span>
            {collectionSlug && <><button type="button" onClick={() => router.push(`/collections/${organizationId}/${collectionSlug}`)} className="cursor-pointer hover:text-tp-ink">{collectionName || collectionSlug}</button><span>/</span></>}
            <span className="text-tp-ink">{pricingName}</span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-normal text-tp-ink">{pricingName}</h1>
              {currentVersion && <p className="mt-1 text-sm text-tp-steel">Updated {formatDistanceToNow(parseISO(currentVersion.createdAt))} ago</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {versions.length > 1 && (
                <select value={currentVersion?.id ?? ''} onChange={e => { const v = versions.find(x => x.id === e.target.value); if (v) setCurrentVersion(v); }}
                  className="h-8 cursor-pointer rounded-lg border border-tp-input-border bg-tp-input-bg px-2 text-xs text-tp-ink focus:border-tp-primary focus:outline-none">
                  {versions.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                </select>
              )}
              {entityPermissions?.CREATE && (
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-xs text-tp-ink transition-colors hover:bg-tp-surface focus:border-tp-primary focus:outline-none"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  New Version
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transitionDefault, delay: 0.05 }} className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ l: 'Configurations', v: a?.configurationSpaceSize?.toLocaleString() ?? '—' }, { l: 'Min price', v: a ? `$${a.minSubscriptionPrice.toFixed(2)}` : '—' }, { l: 'Max price', v: a ? `$${a.maxSubscriptionPrice.toFixed(2)}` : '—' }, { l: 'Versions', v: String(versions.length) }].map(s => (
            <div key={s.l} className="rounded-xl border border-tp-hairline bg-tp-canvas p-3"><p className="text-[11px] text-tp-steel">{s.l}</p><p className="mt-0.5 text-lg font-semibold text-tp-ink">{s.v}</p></div>
          ))}
        </motion.div>

        {/* Tabs */}
        <div className="mb-6 border-b border-tp-hairline">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-2 md:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
            {([
              ['overview', 'Overview'],
              ['analytics', 'Analytics'],
              ['config-space', 'Config Space'],
              ['versions', 'Versions'],
              ...(showSettingsTab ? [['settings', 'Settings'] as const] : []),
            ] as const).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  tab === k
                    ? 'bg-tp-primary text-tp-on-primary shadow-sm'
                    : 'bg-tp-surface text-tp-steel hover:bg-tp-hairline hover:text-tp-ink'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="hidden gap-1 md:flex">
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
        </div>

        <AnimatePresence mode="wait">
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              {isPrivateNoAccess ? <PrivateAccessFallback /> : (
              <>
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(p => !p)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  <svg className={`h-4 w-4 transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                  </svg>
                  {sidebarOpen ? 'Hide details' : 'Show details'}
                </button>
              </div>

              <div className="hidden flex-col gap-6 md:flex md:flex-row">
                <motion.div
                  className="min-w-0 rounded-xl border border-tp-hairline bg-tp-canvas p-4"
                  animate={{ flex: sidebarOpen ? '1 1 0%' : '1 1 100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  {isLoadingYaml ? <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" /></div>
                    : pricing ? <PricingRenderer pricing={pricing} errors={errors} onApplyVariables={handleApplyVariables} />
                    : <div className="flex h-64 items-center justify-center text-sm text-tp-steel">Could not load pricing preview</div>}
                </motion.div>

                <AnimatePresence initial={false}>
                  {sidebarOpen && (
                    <motion.div
                      key="sidebar-desktop"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 360, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      className="overflow-hidden"
                    >
                      <div className="w-[360px] space-y-4">
                        {aSafe && <PricingTree analytics={aSafe} />}
                        {yamlText && <YamlSourcePanel yamlText={yamlText} />}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="md:hidden">
                <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-4">
                  {isLoadingYaml ? <div className="flex h-64 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" /></div>
                    : pricing ? <PricingRenderer pricing={pricing} errors={errors} onApplyVariables={handleApplyVariables} />
                    : <div className="flex h-64 items-center justify-center text-sm text-tp-steel">Could not load pricing preview</div>}
                </div>
              </div>

              <AnimatePresence>
                {sidebarOpen && (
                  <motion.div
                    key="sidebar-mobile"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <motion.div
                      initial={{ y: '100%', opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: '100%', opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      className="max-h-[85vh] w-[90vw] max-w-2xl overflow-y-auto rounded-2xl bg-tp-canvas p-5 shadow-elevation-4"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-tp-ink">Details</h3>
                        <button
                          type="button"
                          onClick={() => setSidebarOpen(false)}
                          className="cursor-pointer rounded-full p-1 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="space-y-4">
                        {aSafe && <PricingTree analytics={aSafe} />}
                        {yamlText && <YamlSourcePanel yamlText={yamlText} />}
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
              </>
              )}
            </motion.div>
          )}

          {/* ANALYTICS */}
          {tab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              {isPrivateNoAccess ? <PrivateAccessFallback /> : (
              <PricingAnalyticsTab
                chartData={chartData}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
              />
              )}
            </motion.div>
          )}

          {/* CONFIGURATION SPACE */}
          {tab === 'config-space' && (
            <motion.div key="config-space" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              {isPrivateNoAccess ? <PrivateAccessFallback /> : (
              <>
              {a && a.configurationSpaceSize && a.configurationSpaceSize > 2000 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline bg-tp-canvas py-16 text-center">
                  <svg className="mb-3 h-10 w-10 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                  <p className="text-sm font-medium text-tp-ink">Configuration space too large</p>
                  <p className="mt-1 max-w-md text-xs text-tp-steel">This pricing has {a.configurationSpaceSize.toLocaleString()} configurations. The explorer is only available for pricing with ≤2,000 configurations.</p>
                </div>
              ) : organizationId && currentVersion ? (
                <ConfigurationSpaceView organizationId={organizationId} pricingSlug={slug!} pricingVersion={currentVersion.version} />
              ) : null}
              </>
              )}
            </motion.div>
          )}

          {/* VERSIONS */}
          {tab === 'versions' && (
            <motion.div key="versions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              {isPrivateNoAccess ? <PrivateAccessFallback /> : (
              <PricingVersionsTab
                versions={versions}
                currentVersion={currentVersion}
                canDelete={canDelete}
                onDownload={handleDownload}
                onOpenInEditor={handleOpenInEditor}
                onCopyLink={handleCopyLink}
                onDelete={handleDelete}
              />
              )}
            </motion.div>
          )}

          {/* SETTINGS */}
          {tab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <PricingSettingsTab
                entityPermissions={entityPermissions}
                visibility={visibility}
                pricingName={pricingName}
                currentVersion={currentVersion}
                onVisibilityChange={handleVisibilityChange}
                onRename={handleRename}
                onDeleteCurrentVersion={handleDeleteCurrentVersion}
                onDeletePricing={handleDeletePricing}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* LINK MODAL */}
      {showLinkModal && (
        <PricingLinkModal linkUrl={linkUrl} onClose={() => { setShowLinkModal(false); }} />
      )}

      {/* IMPORT MODAL */}
      <AnimatePresence>
        {showImportModal && (
          <PricingImportModal
            pricingName={pricingName}
            onImport={handleImportVersion}
            onClose={() => setShowImportModal(false)}
          />
        )}
      </AnimatePresence>

      {/* HARVEY CHAT */}
      <HarveyChat
        yamlContent={yamlText}
        pricingSlug={slug ?? undefined}
        organizationId={organizationId ?? undefined}
        suggestedQuestions={pricingSuggestions}
      />
    </>
  );
}
