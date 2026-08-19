import Editor, { Monaco } from '@monaco-editor/react';
import { useState, useEffect, useRef, useCallback } from 'react';
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
import { useCacheApi } from '../../components/pricing-renderer/api/cacheApi';
import { TEMPLATE_PETCLINIC_PRICING } from './templates/petclinic';
import EditorSkeleton from '../../../core/components/skeletons/editor-skeleton';
import type { PricingDraft } from '../../services/pricing2yaml';
import ProblemsPanel from '../../components/problems-panel';
import { usePricing2YamlLinter } from '../../hooks/usePricing2YamlLinter';
import type { LintDiagnostic, LintSeverity } from '../../services/pricing2yaml/linter';

type SyntaxVersion = '3.0' | '3.1';

/** Namespace under which the linter owns its markers, so it never clears anyone else's. */
const LINTER_MARKER_OWNER = 'pricing2yaml-linter';

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

  const { mode } = useMode();
  const { editorValue, setEditorValue, editorMode, isDirty, setIsDirty, setPendingVisualDraft, saveDraft } = useEditorValue();
  const {getFromCache} = useCacheApi();

  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const [codeEditor, setCodeEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const lint = usePricing2YamlLinter(editorValue);

  const timeoutRef = useRef<any>(null);
  const requestIdRef = useRef(0);

  function handleEditorChange(value: string | undefined) {
    if (value) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const currentRequestId = ++requestIdRef.current;
      timeoutRef.current = setTimeout(async () => {
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
    const fetchPricing = async () => {
      const queryParams = new URLSearchParams(globalThis.location.search);
      const pricingParam = queryParams.get('pricing');
      const pricingUrlParam = queryParams.get('pricingUrl');
      
      let templatePricing: string = '';

      if (pricingUrlParam){
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

      try {
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
        
        setPricing(parsedPricing);
        setEditorValue(templatePricing);
        setErrors([]);
      } catch (err) {
        setErrors([(err as Error).message]);
      }
    };

    fetchPricing();
  }, []);

  useEffect(() => {
    handleEditorChange(editorValue)
  }, [editorValue]);

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
            {pricing ? (
              <VisualPricingEditor
                yaml={editorValue}
                isDirty={isDirty}
                onDraftChange={handleVisualDraftChange}
                onSave={saveDraft}
              />
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
                  }}
                />
              </div>
              <ProblemsPanel
                diagnostics={lint.diagnostics}
                errors={lint.errors}
                warnings={lint.warnings}
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
                }} /> : <EditorSkeleton />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Alerts messages={errors} />
    </>
  );
}
