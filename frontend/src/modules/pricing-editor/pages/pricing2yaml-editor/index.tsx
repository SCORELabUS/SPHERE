import Editor, { Monaco } from '@monaco-editor/react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pricing, retrievePricingFromYaml } from 'pricing4ts';

import { PricingRenderer } from '../../components/pricing-renderer';
import VisualPricingEditor from '../../components/visual-editor';
import { Helmet } from 'react-helmet-async';
import Alerts from '../../../core/components/alerts';
import { useMode } from '../../../core/hooks/useTheme';
import GithubDarkTheme from '../../../core/theme/editor-themes/GitHub-Dark.json';
import TextmateTheme from '../../../core/theme/editor-themes/Textmate.json';
import monaco from 'monaco-editor';
import { useEditorValue } from '../../hooks/useEditorValue';
import { parseEncodedYamlToStringYaml } from '../../services/export.service';
import { takePricingFragment, type PricingFragment } from '../../services/pricing-fragment';
import {
  EDITOR_WAIT_MS,
  LOADING_INDICATOR_DELAY_MS,
  PRICING_LOAD_STARTED,
  afterNextPaint,
  markParsed,
  markShown,
  pricingLoadStatus,
  type PricingLoad,
} from '../../services/pricing-loading';
import { useCacheApi } from '../../components/pricing-renderer/api/cacheApi';
import { TEMPLATE_PETCLINIC_PRICING } from './templates/petclinic';
import { PRICING2YAML_SNIPPETS } from './templates/snippets';
import EditorSkeleton from '../../../core/components/skeletons/editor-skeleton';
import { ensureSyntaxVersion31, parseDraftFromYaml, type PricingDraft } from '../../services/pricing2yaml';
import ProblemsPanel from '../../components/problems-panel';
import ErrorBoundary from '../../../core/components/error-boundary';
import { VisualEditorUnavailable } from '../../components/visual-editor/components/VisualEditorUnavailable';
import TemplatesMenu from '../../components/templates-menu';
import { usePricingsApi } from '../../../pricing/api/pricingsApi';
import { usePricing2YamlLinter } from '../../hooks/usePricing2YamlLinter';
import { usePricing2YamlSnippets } from '../../hooks/usePricing2YamlSnippets';
import { templatesShortcutLabel } from '../../services/pricing2yaml/snippets';
import type { LintDiagnostic, LintSeverity } from '../../services/pricing2yaml/linter';

type SyntaxVersion = '3.0' | '3.1';

/** Namespace under which the linter owns its markers, so it never clears anyone else's. */
const LINTER_MARKER_OWNER = 'pricing2yaml-linter';

/** Shortcut advertised next to the templates menu. */
const TEMPLATES_SHORTCUT = templatesShortcutLabel();

/**
 * Plain scalars are strings to the YAML tokenizer, and Monaco keeps quick
 * suggestions off inside strings by default — which is precisely where a
 * top-level `feature` or `plan` is typed. Turning them on is what makes the
 * templates suggest themselves as the user types.
 */
const EDITOR_QUICK_SUGGESTIONS = { other: true, comments: false, strings: true } as const;

function normalizeSyntaxVersion(value?: string): SyntaxVersion {
  return value === '3.1' ? '3.1' : '3.0';
}

function toMarkerSeverity(monacoInstance: Monaco, severity: LintSeverity): number {
  switch (severity) {
    case 'error':
      return monacoInstance.MarkerSeverity.Error;
    case 'warning':
      return monacoInstance.MarkerSeverity.Warning;
    default:
      return monacoInstance.MarkerSeverity.Info;
  }
}

// function replaceSyntaxVersionInYaml(yaml: string, version: SyntaxVersion): string {
//   const syntaxVersionRegex = /^(\s*syntaxVersion:\s*)(['"]?)([^'"\n\r]+)\2(\s*)$/m;

//   if (syntaxVersionRegex.test(yaml)) {
//     return yaml.replace(syntaxVersionRegex, `$1"${version}"$4`);
//   }

//   const saasNameRegex = /^(saasName:.*)$/m;
//   const saasNameMatch = saasNameRegex.exec(yaml);
//   if (saasNameMatch) {
//     const insertIndex = (saasNameMatch.index ?? 0) + saasNameMatch[0].length;
//     return `${yaml.slice(0, insertIndex)}\nsyntaxVersion: "${version}"${yaml.slice(insertIndex)}`;
//   }

//   return `syntaxVersion: "${version}"\n${yaml}`;
// }

export default function EditorPage() {
  const [pricing, setPricing] = useState<Pricing>();
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedSyntaxVersion, setSelectedSyntaxVersion] = useState<SyntaxVersion>('3.1');
  /** Why the pricing the editor was opened with could not be shown, when it could not. */
  const [loadError, setLoadError] = useState<string | null>(null);
  // The `#pricing=` fragment is removed from the URL as soon as it is read, so it
  // is read once per mount: React's strict mode runs the loading effect twice,
  // and its second run would no longer find it.
  const pricingFragmentRef = useRef<PricingFragment | null>(null);
  // The pricing being opened, from the start: the editor always opens one.
  const [pricingLoad, setPricingLoad] = useState<PricingLoad | null>(PRICING_LOAD_STARTED);
  // The YAML the loading code has just parsed for the preview, so the debounced
  // parse that follows every change does not parse it a second time.
  const loadedYamlRef = useRef<string | null>(null);

  const { mode } = useMode();
  const { editorValue, setEditorValue, editorMode, setEditorMode, isDirty, setIsDirty, setPendingVisualDraft, saveDraft, setSourcePricing } = useEditorValue();
  const {getFromCache} = useCacheApi();
  const { getPricingBySlug } = usePricingsApi();

  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const [codeEditor, setCodeEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lint = usePricing2YamlLinter(editorValue);
  const [isTemplatesMenuOpen, setIsTemplatesMenuOpen] = useState(false);
  const insertSnippet = usePricing2YamlSnippets(
    codeEditor,
    monacoInstance,
    PRICING2YAML_SNIPPETS,
    useCallback(() => setIsTemplatesMenuOpen(true), [])
  );

  // The visual editor builds its draft while rendering, so a document it cannot
  // read would throw mid-render and blank the page. The parse is tried here
  // first, and its failure shown as a panel instead.
  const visualDraftError = useMemo(() => {
    if (!editorValue) {
      return null;
    }

    try {
      parseDraftFromYaml(ensureSyntaxVersion31(editorValue));

      return null;
    } catch (err) {
      return (err as Error).message.split('\n')[0].trim();
    }
  }, [editorValue]);

  const timeoutRef = useRef<any>(null);
  const requestIdRef = useRef(0);

  function handleEditorChange(value: string | undefined) {
    if (value) {
      setLoadError(null);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const currentRequestId = ++requestIdRef.current;
      timeoutRef.current = setTimeout(async () => {
        const alreadyParsed = value === loadedYamlRef.current;
        loadedYamlRef.current = null;

        if (alreadyParsed) {
          return;
        }

        try {
          setEditorValue(value);

          const regex = /^syntaxVersion:\s*['"]?([^'"\n\r]+)['"]?$/m;
          const syntaxVersion = value.match(regex)?.[1];
          let parsedPricing: Pricing;

          if (syntaxVersion !== '3.1') {
            const response = await fetch('/api/v1/pricings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pricing: value }),
            });

            if (!response.ok) {
              throw new Error('Failed to parse pricing. Please check the YAML syntax.');
            }

            parsedPricing = await response.json();
          } else {
            parsedPricing = retrievePricingFromYaml(value);
          }

          if (currentRequestId !== requestIdRef.current) return;

          if (!['3.0', '3.1'].includes(parsedPricing.syntaxVersion)) {
            throw new Error('Only Pricing YAML syntax version 3.X is supported in this editor.');
          }

          setPricing(parsedPricing);
          setErrors([]);
        } catch (err) {
          if (currentRequestId !== requestIdRef.current) return;
          // Only the current failure is relevant: the linter is what enumerates
          // every problem, so keeping a growing pile of stale toasts here is noise.
          setErrors([(err as Error).message]);
        }
      }, 1000);
    }
  }

  function handleEditorDidMount(editorInstance: Monaco) {
    editorInstance.editor.defineTheme(
      'github-dark',
      GithubDarkTheme as monaco.editor.IStandaloneThemeData
    );
    editorInstance.editor.defineTheme(
      'textmate',
      TextmateTheme as monaco.editor.IStandaloneThemeData
    );
  }

  function handleEditorMounted(
    editorInstance: monaco.editor.IStandaloneCodeEditor,
    monacoNamespace: Monaco
  ) {
    setCodeEditor(editorInstance);
    setMonacoInstance(monacoNamespace);
  }

  /** Moves the caret to a diagnostic so the user can fix it straight away. */
  function goToDiagnostic(diagnostic: LintDiagnostic) {
    if (!codeEditor) {
      return;
    }

    codeEditor.revealLineInCenter(diagnostic.startLineNumber);
    codeEditor.setPosition({
      lineNumber: diagnostic.startLineNumber,
      column: diagnostic.startColumn,
    });
    codeEditor.focus();
  }

  useEffect(() => {
    // Read and removed from the URL before anything else runs (see
    // `takePricingFragment`), whether or not it can be decoded.
    if (pricingFragmentRef.current === null) {
      pricingFragmentRef.current = takePricingFragment(globalThis.location, globalThis.history);
    }
    const fragment = pricingFragmentRef.current;

    // Shows a pricing's YAML, then the pricing parsed from it.
    const showPricing = async (templatePricing: string) => {
      // The loading indicator is painted before the long tasks below start.
      await afterNextPaint();

      // Shown as soon as it's known, even if parsing below fails: otherwise a
      // pricing that fails validation (e.g. an invalid currency code) leaves
      // the editor blank instead of showing the YAML the user needs to fix.
      setEditorValue(templatePricing);
      setPricingLoad(markShown);

      // Monaco gets the text (and paints it) before parsing blocks the page.
      await afterNextPaint();

      const regex = /^syntaxVersion:\s*['"]?([^'"\n\r]+)['"]?$/m;
      const syntaxVersion = templatePricing.match(regex)?.[1];
      let parsedPricing: Pricing;
      const normalizedVersion = normalizeSyntaxVersion(syntaxVersion);

      setSelectedSyntaxVersion(normalizedVersion);

      if (syntaxVersion !== '3.1'){
        const response = await fetch('/api/v1/pricings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pricing: templatePricing }),
        })

        parsedPricing = await response.json();
      }else{
        parsedPricing = retrievePricingFromYaml(templatePricing);
      }

      loadedYamlRef.current = templatePricing;
      setPricing(parsedPricing);
      setErrors([]);
      setPricingLoad(markParsed);
    };

    const fetchPricing = async () => {
      // `#pricing=` goes before every query parameter. Only a caller that means
      // to hand over this exact content writes it (SPACE's "View in SPHERE"),
      // and it is the one source that stays in the browser: letting a query
      // parameter win would load something else (possibly fetched from a
      // server) while the content the user opened silently disappears.
      if (fragment.status === 'invalid') {
        // No template in its place: the user would take it for their pricing.
        setLoadError(fragment.error);
        setErrors([fragment.error]);
        setPricingLoad(null);
        return;
      }

      const queryParams = new URLSearchParams(globalThis.location.search);
      const pricingParam = queryParams.get('pricing');
      const pricingUrlParam = queryParams.get('pricingUrl');
      const sourceParam = queryParams.get('source');
      
      let templatePricing: string = '';

      try {
        if (fragment.status === 'ok') {
          templatePricing = fragment.yaml;
        } else if (sourceParam) {
          // `source=<organizationId>/<slug>`: a published version opened for editing.
          const [organizationId, slug] = sourceParam.split('/');
          const collectionSlug = queryParams.get('collection');
          const requestedVersion = queryParams.get('version');
          const data = await getPricingBySlug(slug, organizationId, collectionSlug);
          const versions: { version: string; yaml: string }[] = data.versions ?? [];
          const sourceVersion = versions.find(v => v.version === requestedVersion) ?? versions[0];
          if (!sourceVersion) throw new Error('The pricing to edit has no versions.');
          const yamlUrl = sourceVersion.yaml.startsWith('http') ? sourceVersion.yaml : `${import.meta.env.VITE_API_URL}${sourceVersion.yaml}`;
          templatePricing = await (await fetch(yamlUrl)).text();
          setSourcePricing({
            organizationId,
            slug,
            collectionSlug: collectionSlug && collectionSlug !== 'undefined' ? collectionSlug : null,
            name: data.name ?? slug,
            version: sourceVersion.version,
          });
          if (queryParams.get('mode') === 'visual') {
            templatePricing = ensureSyntaxVersion31(templatePricing);
            setEditorMode('visual');
          }
        } else if (pricingUrlParam){
          const response = await fetch(pricingUrlParam);
          templatePricing = await response.text();
        }else if (!pricingParam) {
          templatePricing = TEMPLATE_PETCLINIC_PRICING;
        } else {
          if (pricingParam.length > 36){ // It is greater that UUID
            templatePricing = parseEncodedYamlToStringYaml(pricingParam);
          }else{
            const cachedPricing = await getFromCache(pricingParam);

            templatePricing = parseEncodedYamlToStringYaml(cachedPricing);
          }
        }

        await showPricing(templatePricing);
      } catch (err) {
        setErrors([(err as Error).message]);
        setPricingLoad(markParsed);
      }
    };

    // A `#pricing=` link opened in a tab that already shows the editor (same
    // path and query) only changes the fragment, so the page does not reload.
    const handleHashChange = () => {
      const next = takePricingFragment(globalThis.location, globalThis.history);

      if (next.status === 'absent') {
        return;
      }

      if (next.status === 'invalid') {
        // What the editor holds stays: it may be the user's own work.
        setErrors([next.error]);
        return;
      }

      // Like importing a file, the new pricing replaces the editor's content,
      // and it is no longer a version of the pricing it was opened from.
      setSourcePricing(null);
      setLoadError(null);
      setPricingLoad(PRICING_LOAD_STARTED);
      showPricing(next.yaml).catch(err => {
        setErrors([(err as Error).message]);
        setPricingLoad(markParsed);
      });
    };

    fetchPricing();
    globalThis.addEventListener('hashchange', handleHashChange);

    return () => globalThis.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    handleEditorChange(editorValue)
  }, [editorValue]);

  // Ends the loading state once the pricing is in Monaco, previewed and linted.
  useEffect(() => {
    if (pricingLoad === null) {
      return;
    }

    const status = () =>
      pricingLoadStatus(pricingLoad, {
        editorValue,
        lintedValue: lint.lintedValue,
        codeEditorValue: codeEditor?.getModel()?.getValue() ?? null,
        visual: editorMode === 'visual',
      });

    const current = status();

    if (current === 'done') {
      setPricingLoad(null);
      return;
    }

    if (current === 'loading') {
      return;
    }

    // Only Monaco is missing: it is still being fetched, or has not taken the
    // text yet (it does so in an effect of its own, with no render to tell).
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (status() === 'done' || Date.now() - startedAt > EDITOR_WAIT_MS) {
        setPricingLoad(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [pricingLoad, editorValue, lint.lintedValue, codeEditor, editorMode]);

  // Publishes the linter output as editor markers, which is what draws the
  // squiggles and the hover tooltips over the offending YAML.
  useEffect(() => {
    const model = codeEditor?.getModel();

    if (!monacoInstance || !model) {
      return;
    }

    monacoInstance.editor.setModelMarkers(
      model,
      LINTER_MARKER_OWNER,
      lint.diagnostics.map(diagnostic => ({
        severity: toMarkerSeverity(monacoInstance, diagnostic.severity),
        message: diagnostic.message,
        code: diagnostic.code,
        source: 'Pricing2Yaml',
        startLineNumber: diagnostic.startLineNumber,
        startColumn: diagnostic.startColumn,
        endLineNumber: diagnostic.endLineNumber,
        endColumn: diagnostic.endColumn,
      }))
    );

    return () => {
      if (!model.isDisposed()) {
        monacoInstance.editor.setModelMarkers(model, LINTER_MARKER_OWNER, []);
      }
    };
  }, [monacoInstance, codeEditor, lint]);

  useEffect(() => {
    if (!editorValue) {
      return;
    }

    const regex = /^syntaxVersion:\s*['"]?([^'"\n\r]+)['"]?$/m;
    const currentVersion = normalizeSyntaxVersion(editorValue.match(regex)?.[1]);

    if (currentVersion !== selectedSyntaxVersion) {
      setSelectedSyntaxVersion(currentVersion);
    }
  }, [editorValue, selectedSyntaxVersion]);

  // function handleSyntaxVersionChange(version: SyntaxVersion) {
  //   setSelectedSyntaxVersion(version);

  //   if (!editorValue) {
  //     return;
  //   }

  //   const nextValue = replaceSyntaxVersionInYaml(editorValue, version);
  //   if (nextValue !== editorValue) {
  //     setEditorValue(nextValue);
  //   }
  // }

  const handleVisualDraftChange = useCallback((draft: PricingDraft) => {
    setPendingVisualDraft(draft);
    setIsDirty(true);
  }, [setPendingVisualDraft, setIsDirty]);

  return (
    <>
      <Helmet>
        <title>SPHERE - Pricing2Yaml Editor</title>
      </Helmet>

      <AnimatePresence mode="wait">
        {editorMode === 'visual' ? (
          <motion.div
            key="visual"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="h-full w-full"
          >
            {visualDraftError !== null ? (
              <VisualEditorUnavailable
                message={visualDraftError}
                onBackToCode={() => setEditorMode('code')}
              />
            ) : pricing ? (
              <ErrorBoundary
                resetKey={editorValue}
                fallback={error => (
                  <VisualEditorUnavailable
                    message={error.message}
                    onBackToCode={() => setEditorMode('code')}
                  />
                )}
              >
                <VisualPricingEditor
                  yaml={editorValue}
                  isDirty={isDirty}
                  onDraftChange={handleVisualDraftChange}
                  onSave={saveDraft}
                />
              </ErrorBoundary>
            ) : (
              <EditorSkeleton />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="grid h-full w-full gap-4 bg-slate-300 lg:grid-cols-2"
          >
            <div className="relative flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-tp-surface-code px-3 py-1.5">
                <TemplatesMenu
                  snippets={PRICING2YAML_SNIPPETS}
                  onSelect={insertSnippet}
                  isOpen={isTemplatesMenuOpen}
                  onOpenChange={setIsTemplatesMenuOpen}
                  disabled={!codeEditor}
                />
                <p className="hidden text-[10px] text-white/30 lg:block">
                  Type <span className="font-mono text-white/45">feature</span>,{' '}
                  <span className="font-mono text-white/45">plan</span>… in the editor, or press{' '}
                  <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-white/45">
                    {TEMPLATES_SHORTCUT}
                  </kbd>
                </p>
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  height="100%"
                  defaultLanguage="yaml"
                  onChange={handleEditorChange}
                  value={editorValue}
                  theme={mode === 'light' ? 'textmate' : 'github-dark'}
                  beforeMount={handleEditorDidMount}
                  onMount={handleEditorMounted}
                  options={{
                    minimap: {
                      enabled: false,
                    },
                    fontSize: 16,
                    quickSuggestions: EDITOR_QUICK_SUGGESTIONS,
                  }}
                />
              </div>
              <ProblemsPanel
                diagnostics={lint.diagnostics}
                errors={lint.errors}
                warnings={lint.warnings}
                parseErrors={errors}
                onSelect={goToDiagnostic}
              />
            </div>
            <div className="box-border flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-slate-200 py-2">
              <div className="w-full">
                {pricing ? <PricingRenderer pricing={pricing} errors={errors} onApplyVariables={(variables) => {
                  const newYaml = (function replaceVariablesInYaml(yaml: string, vars: Record<string, unknown>) {
                    const serializeVal = (v: unknown) => {
                      if (typeof v === 'string') return JSON.stringify(v);
                      if (typeof v === 'boolean') return v ? 'true' : 'false';
                      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
                      return JSON.stringify(v);
                    };

                    const varsLines = ['variables:'];
                    for (const k of Object.keys(vars)) {
                      varsLines.push(`  ${k}: ${serializeVal(vars[k])}`);
                    }
                    const varsBlock = varsLines.join('\n');

                    const variablesRegex = /^variables:\n(?:[ \t]+.+\n?)*/gm;

                    if (variablesRegex.test(yaml)) {
                      return yaml.replace(variablesRegex, varsBlock + '\n');
                    } else {
                      const insertAfterRegex = /^(createdAt:.*|currency:.*)$/mi;
                      const m = insertAfterRegex.exec(yaml);
                      if (m) {
                        const idx = (m.index ?? 0) + (m[0]?.length ?? 0);
                        return yaml.slice(0, idx) + '\n' + varsBlock + yaml.slice(idx);
                      }
                      return yaml + '\n' + varsBlock + '\n';
                    }
                  })(editorValue, variables);

                  setEditorValue(newYaml);
                }} /> : loadError ? (
                  <div role="alert" className="m-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">There is no pricing to show</p>
                    <p className="mt-1">{loadError}</p>
                  </div>
                ) : <EditorSkeleton />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pricingLoad !== null ? (
        // Fades in after LOADING_INDICATOR_DELAY_MS, so a quick load does not
        // flicker. Opacity and rotation run on the compositor, so the overlay
        // keeps appearing and spinning while the main thread is busy.
        <div
          role="status"
          aria-live="polite"
          data-testid="pricing-loading"
          className="absolute inset-0 z-40 flex items-center justify-center bg-tp-ink/40"
          style={{ animation: `fade-in 200ms ease-out ${LOADING_INDICATOR_DELAY_MS}ms both` }}
        >
          <div className="flex items-center gap-3 rounded-lg border border-tp-hairline bg-tp-canvas px-4 py-3 text-sm font-medium text-tp-ink shadow-elevation-4">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-tp-primary border-t-transparent"
            />
            Loading pricing…
          </div>
        </div>
      ) : null}

      <Alerts messages={errors} />
    </>
  );
}
