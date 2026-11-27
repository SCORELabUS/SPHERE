import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Pricing } from 'pricing4ts';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import { transitionDefault } from '../../../core/utils/motion-variants';
import PrivateAccessFallback from '../private-access-fallback';
import PricingTree from '../pricing-tree';
import YamlSourcePanel from '../yaml-source-panel';
import type { TreeAnalytics } from '../../types/card';

export default function PricingCardOverview({ isPrivateNoAccess = false, isLoadingYaml = false, pricing, errors, handleApplyVariables, aSafe, yamlText, hasVersion }: {
  isPrivateNoAccess?: boolean; isLoadingYaml?: boolean; pricing: Pricing | null; errors: string[];
  handleApplyVariables: (variables: Record<string, unknown>) => void; aSafe: TreeAnalytics | null; yamlText: string; hasVersion: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={transitionDefault}
            >
              {isPrivateNoAccess ? (
                <PrivateAccessFallback />
              ) : (
                <>
                  <div className="mb-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(p => !p)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                    >
                      <svg
                        className={`h-4 w-4 transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
                        />
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
                      {isLoadingYaml ? (
                        <div className="flex h-64 items-center justify-center">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" />
                        </div>
                      ) : pricing ? (
                        <PricingRenderer
                          pricing={pricing}
                          errors={errors}
                          onApplyVariables={handleApplyVariables}
                        />
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-tp-steel">
                          Could not load pricing preview
                        </div>
                      )}
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
                            {aSafe ? (
                              <PricingTree analytics={aSafe} />
                            ) : (
                              hasVersion && <NoAnalyticsNotice />
                            )}
                            {yamlText && <YamlSourcePanel yamlText={yamlText} />}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="md:hidden">
                    <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-4">
                      {isLoadingYaml ? (
                        <div className="flex h-64 items-center justify-center">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" />
                        </div>
                      ) : pricing ? (
                        <PricingRenderer
                          pricing={pricing}
                          errors={errors}
                          onApplyVariables={handleApplyVariables}
                        />
                      ) : (
                        <div className="flex h-64 items-center justify-center text-sm text-tp-steel">
                          Could not load pricing preview
                        </div>
                      )}
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
                              <svg
                                className="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                          <div className="space-y-4">
                            {aSafe ? (
                              <PricingTree analytics={aSafe} />
                            ) : (
                              hasVersion && <NoAnalyticsNotice />
                            )}
                            {yamlText && <YamlSourcePanel yamlText={yamlText} />}
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </motion.div>

  );
}

function NoAnalyticsNotice() {
  return <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-4 text-xs text-tp-steel">The analytics of this version are not available.</div>;
}
