import { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaRegCircleXmark,
  FaCalculator,
  FaList,
  FaCode,
  FaPlus,
  FaTrash,
  FaCircleInfo,
} from 'react-icons/fa6';
import { camelToTitle } from '../shared/stringUtils';

type JsonPrimitive = string | number | boolean | null;
type VarValue = JsonPrimitive | VarValue[] | { [key: string]: VarValue };
type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
type CollectionItemKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

interface Props {
  open: boolean;
  onClose: () => void;
  variables: Record<string, VarValue> | undefined;
  onApply: (variables: Record<string, VarValue>) => void;
}

function getValueKind(value: VarValue): ValueKind {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function isPlainObject(value: unknown): value is { [key: string]: VarValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonText(value: VarValue): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function kindLabel(kind: ValueKind): string {
  if (kind === 'array') return 'List';
  if (kind === 'object') return 'Object';
  if (kind === 'null') return 'Null';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function collectionTypeOf(v: VarValue): CollectionItemKind {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  return 'json';
}

function defaultValueForCollectionKind(kind: CollectionItemKind): VarValue {
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  if (kind === 'null') return null;
  if (kind === 'json') return {};
  return '';
}

function parseCollectionValue(raw: string, kind: CollectionItemKind): VarValue {
  if (kind === 'string') return raw;
  if (kind === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'null') return null;
  try {
    return JSON.parse(raw) as VarValue;
  } catch {
    return raw;
  }
}

function NumberEditor({
  variableKey,
  original,
  value,
  decimalsAllowed,
  onValueChange,
  onDecimalsChange,
}: {
  variableKey: string;
  original: number;
  value: VarValue;
  decimalsAllowed: boolean;
  onValueChange: (next: number) => void;
  onDecimalsChange: (next: boolean) => void;
}) {
  const current = typeof value === 'number' ? value : 0;
  const sliderValue = (() => {
    const base = Number(original) || 0;
    if (base === 0) return 50;
    const mult = current / base || 1;
    const maxLog = 4;
    const log = Math.log10(Math.max(mult, 1e-9));
    const ratio = Math.max(0, Math.min(100, ((log / maxLog) * 100) + 50));
    return Math.round(ratio);
  })();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <input
          type="number"
          value={current}
          step={decimalsAllowed ? 0.01 : 1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            onValueChange(decimalsAllowed ? Number(n.toFixed(2)) : Math.round(n));
          }}
          className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 text-sm text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
        />

        <div className="flex items-center gap-3 rounded-lg border border-tp-hairline bg-tp-surface px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-tp-steel">Base</span>
          <span className="text-sm font-semibold text-tp-ink">{String(original)}</span>
          <span className="text-tp-hairline-strong">|</span>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-tp-charcoal">
            <input
              type="checkbox"
              checked={decimalsAllowed}
              onChange={(e) => onDecimalsChange(e.target.checked)}
              className="accent-tp-primary"
            />
            {decimalsAllowed ? '2 decimales' : 'Enteros'}
          </label>
        </div>
      </div>

      <div>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => {
            const s = Number(e.target.value);
            const maxLog = 4;
            const log = ((s - 50) / 100) * maxLog;
            const mult = Math.pow(10, log);
            const newVal = original * mult;
            onValueChange(decimalsAllowed ? Number(newVal.toFixed(2)) : Math.round(newVal));
          }}
          aria-label={`Range editor for ${variableKey}`}
          className="w-full accent-tp-primary"
        />
      </div>
    </div>
  );
}

function CollectionTypeSelector({
  value,
  onChange,
}: {
  value: CollectionItemKind;
  onChange: (next: CollectionItemKind) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CollectionItemKind)}
      className="rounded-lg border border-tp-input-border bg-tp-input-bg px-2 py-1.5 text-xs font-medium text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
    >
      <option value="string">string</option>
      <option value="number">number</option>
      <option value="boolean">boolean</option>
      <option value="null">null</option>
      <option value="json">json</option>
    </select>
  );
}

function CollectionValueEditor({
  type,
  value,
  onChange,
}: {
  type: CollectionItemKind;
  value: VarValue;
  onChange: (next: VarValue) => void;
}) {
  if (type === 'boolean') {
    return (
      <select
        value={value === true ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
        className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (type === 'null') {
    return <div className="rounded-lg border border-dashed border-tp-hairline-strong bg-tp-surface px-3 py-2 text-xs text-tp-steel">null</div>;
  }

  if (type === 'json') {
    return (
      <textarea
        value={toJsonText(value)}
        onChange={(e) => onChange(parseCollectionValue(e.target.value, 'json'))}
        className="h-24 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-xs text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
      />
    );
  }

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      value={type === 'number' ? (typeof value === 'number' ? value : 0) : String(value ?? '')}
      onChange={(e) => onChange(parseCollectionValue(e.target.value, type))}
      className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
    />
  );
}

function ArrayEditor({
  value,
  onChange,
}: {
  value: VarValue[];
  onChange: (next: VarValue[]) => void;
}) {
  const itemTypes = useMemo(() => value.map((item) => collectionTypeOf(item)), [value]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-tp-steel">{value.length} items</div>
        <button
          type="button"
          onClick={() => onChange([...value, ''])}
          className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-tp-primary/30 bg-tp-primary/10 px-2.5 py-1.5 text-xs font-semibold text-tp-primary transition-colors hover:bg-tp-primary/20"
        >
          <FaPlus /> Add item
        </button>
      </div>

      <div className="space-y-2">
        {value.map((item, idx) => (
          <div key={`array-item-${idx}`} className="grid gap-2 rounded-lg border border-tp-hairline bg-tp-canvas p-3 md:grid-cols-[110px_1fr_auto]">
            <CollectionTypeSelector
              value={itemTypes[idx]}
              onChange={(nextType) => {
                const next = [...value];
                next[idx] = defaultValueForCollectionKind(nextType);
                onChange(next);
              }}
            />

            <CollectionValueEditor
              type={itemTypes[idx]}
              value={item}
              onChange={(nextValue) => {
                const next = [...value];
                next[idx] = nextValue;
                onChange(next);
              }}
            />

            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
              className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-700 transition-colors hover:bg-red-100"
              aria-label={`Remove item ${idx + 1}`}
            >
              <FaTrash />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ObjectEditor({
  value,
  onChange,
}: {
  value: { [key: string]: VarValue };
  onChange: (next: { [key: string]: VarValue }) => void;
}) {
  const entries = Object.entries(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-tp-steel">{entries.length} properties</div>
        <button
          type="button"
          onClick={() => {
            let candidate = 'newKey';
            let i = 1;
            while (Object.prototype.hasOwnProperty.call(value, candidate)) {
              candidate = `newKey${i}`;
              i += 1;
            }
            onChange({ ...value, [candidate]: '' });
          }}
          className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-tp-primary/30 bg-tp-primary/10 px-2.5 py-1.5 text-xs font-semibold text-tp-primary transition-colors hover:bg-tp-primary/20"
        >
          <FaPlus /> Add property
        </button>
      </div>

      <div className="space-y-2">
        {entries.map(([key, item]) => {
          const itemType = collectionTypeOf(item);
          return (
            <div key={key} className="grid gap-2 rounded-lg border border-tp-hairline bg-tp-canvas p-3 md:grid-cols-[1fr_110px_1.7fr_auto]">
              <input
                type="text"
                value={key}
                onChange={(e) => {
                  const nextKey = e.target.value.trim();
                  if (!nextKey || nextKey === key || Object.prototype.hasOwnProperty.call(value, nextKey)) return;
                  const next = { ...value };
                  delete next[key];
                  next[nextKey] = item;
                  onChange(next);
                }}
                className="rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
              />

              <CollectionTypeSelector
                value={itemType}
                onChange={(nextType) => onChange({ ...value, [key]: defaultValueForCollectionKind(nextType) })}
              />

              <CollectionValueEditor
                type={itemType}
                value={item}
                onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
              />

              <button
                type="button"
                onClick={() => {
                  const next = { ...value };
                  delete next[key];
                  onChange(next);
                }}
                className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-700 transition-colors hover:bg-red-100"
                aria-label={`Remove property ${key}`}
              >
                <FaTrash />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function VariablesEditor({ open, onClose, variables, onApply }: Props) {
  const initial = useMemo(() => variables ?? {}, [variables]);
  const [local, setLocal] = useState<Record<string, VarValue>>(initial);
  const [decimalsAllowed, setDecimalsAllowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLocal(initial);
    const decMap: Record<string, boolean> = {};
    for (const k of Object.keys(initial)) decMap[k] = false;
    setDecimalsAllowed(decMap);
  }, [open, initial]);

  const keys = useMemo(() => Object.keys(initial), [initial]);

  const normalizeValue = useCallback((v: unknown): VarValue => {
    if (v === null) return null;
    if (Array.isArray(v)) return v.map(normalizeValue);
    if (isPlainObject(v)) {
      const out: Record<string, VarValue> = {};
      for (const [key, value] of Object.entries(v)) out[key] = normalizeValue(value);
      return out;
    }
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s === 'true') return true;
      if (s === 'false') return false;
      if (s === 'null') return null;
      const n = Number(s);
      if (s !== '' && !Number.isNaN(n)) return n;
      return s;
    }
    return String(v ?? '');
  }, []);

  const handleApply = () => {
    const out: Record<string, VarValue> = {};
    for (const k of keys) out[k] = normalizeValue(local[k]);
    onApply(out);
    onClose();
  };

  const handleReset = () => {
    setLocal(initial);
    const decMap: Record<string, boolean> = {};
    for (const k of Object.keys(initial)) decMap[k] = false;
    setDecimalsAllowed(decMap);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-tp-ink/80 p-3 backdrop-blur-sm transition ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-hidden={!open}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16, scale: 0.99 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="max-h-[93vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4"
      >
        <div className="border-b border-tp-hairline px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-tp-ink">Variables Simulator</h2>
              <p className="mt-1 text-sm text-tp-steel">
                Experiment with different values for the variables defined in this pricing!
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-tp-primary/10 px-3 py-1 text-xs font-semibold text-tp-primary">
                <FaCircleInfo /> {keys.length} editable variables
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg border border-tp-hairline bg-tp-canvas p-2.5 text-tp-steel transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
              aria-label="close"
            >
              <FaRegCircleXmark />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {keys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-tp-hairline-strong bg-tp-surface py-20 text-center text-tp-steel">
              <div className="text-lg font-semibold text-tp-ink">No variables found</div>
              <div className="text-sm text-tp-steel">This pricing does not declare any editable variables.</div>
            </div>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.04 } } }}
                initial="hidden"
                animate="show"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  {keys.map((k, idx) => {
                    const original = initial[k];
                    const value = local[k];
                    const kind = getValueKind(original);

                    return (
                      <div key={k}>
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 28, delay: idx * 0.02 }}
                        >
                          <div className="rounded-xl border border-tp-hairline bg-tp-canvas p-4 shadow-elevation-1">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <div className="font-bold text-tp-ink">{camelToTitle(k)}</div>
                                <div className="mt-0.5 inline-flex items-center gap-2 text-xs text-tp-steel">
                                  <span className="rounded-full border border-tp-hairline bg-tp-surface px-2 py-0.5">{kindLabel(kind)}</span>
                                  <span className="rounded-full border border-tp-hairline bg-tp-surface px-2 py-0.5">raw: {k}</span>
                                </div>
                              </div>

                              <div className="max-w-45 rounded-lg border border-tp-hairline bg-tp-surface px-2.5 py-1.5 text-right text-xs font-semibold text-tp-charcoal">
                                {kind === 'boolean'
                                  ? value === true
                                    ? 'True'
                                    : 'False'
                                  : kind === 'array'
                                    ? `${Array.isArray(value) ? value.length : 0} items`
                                    : kind === 'object'
                                      ? `${isPlainObject(value) ? Object.keys(value).length : 0} props`
                                      : String(value)}
                              </div>
                            </div>

                            {kind === 'boolean' && (
                              <motion.button
                                type="button"
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setLocal(s => ({ ...s, [k]: value === true ? false : true }))}
                                aria-pressed={value === true}
                                className={`group relative flex w-full max-w-80 cursor-pointer items-center justify-between overflow-hidden rounded-xl border p-2.5 text-left shadow-elevation-1 transition ${
                                  value === true
                                    ? 'border-tp-primary bg-tp-primary text-tp-on-primary'
                                    : 'border-tp-hairline bg-tp-canvas text-tp-charcoal hover:border-tp-primary/40 hover:bg-tp-primary/5'
                                }`}
                              >
                                <div className="relative z-10 flex items-center gap-3 px-1.5 py-1">
                                  <div>
                                    <div className="text-sm font-semibold leading-5">{value === true ? 'Enabled' : 'Disabled'}</div>
                                    <div className={`text-[11px] font-medium ${value === true ? 'text-tp-on-primary/80' : 'text-tp-steel'}`}>
                                      Click to switch state
                                    </div>
                                  </div>
                                </div>

                                <div className="relative z-10 flex items-center">
                                  <div
                                    className={`relative h-8 w-14 rounded-full p-1 transition ${
                                      value === true ? 'bg-white/20' : 'bg-tp-hairline'
                                    }`}
                                  >
                                    <motion.span
                                      animate={{ x: value === true ? 24 : 0 }}
                                      transition={{ type: 'spring', stiffness: 700, damping: 35 }}
                                      className={`block h-6 w-6 rounded-full shadow-md ${value === true ? 'bg-white' : 'bg-tp-stone'}`}
                                    />
                                  </div>
                                </div>
                              </motion.button>
                            )}

                            {kind === 'number' && (
                              <NumberEditor
                                variableKey={k}
                                original={typeof original === 'number' ? original : 0}
                                value={value}
                                decimalsAllowed={decimalsAllowed[k] === true}
                                onValueChange={(next) => setLocal((s) => ({ ...s, [k]: next }))}
                                onDecimalsChange={(next) => setDecimalsAllowed((s) => ({ ...s, [k]: next }))}
                              />
                            )}

                            {kind === 'string' && (
                              <input
                                type="text"
                                value={String(value ?? '')}
                                onChange={(e) => setLocal(s => ({ ...s, [k]: e.target.value }))}
                                className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2.5 text-sm text-tp-ink outline-none transition focus:border-tp-primary focus:ring-2 focus:ring-tp-primary/20"
                              />
                            )}

                            {kind === 'null' && (
                              <div className="rounded-lg border border-dashed border-tp-hairline-strong bg-tp-surface px-4 py-3 text-sm text-tp-steel">
                                This variable is currently <span className="font-semibold text-tp-ink">null</span>.
                              </div>
                            )}

                            {kind === 'array' && (
                              <div className="space-y-3">
                                <div className="inline-flex items-center gap-2 rounded-lg bg-tp-primary/10 px-2.5 py-1 text-xs font-semibold text-tp-primary">
                                  <FaList /> List editor
                                </div>
                                <ArrayEditor
                                  value={Array.isArray(value) ? value : []}
                                  onChange={(next) => setLocal((s) => ({ ...s, [k]: next }))}
                                />
                              </div>
                            )}

                            {kind === 'object' && (
                              <div className="space-y-3">
                                <div className="inline-flex items-center gap-2 rounded-lg bg-tp-primary/10 px-2.5 py-1 text-xs font-semibold text-tp-primary">
                                  <FaCode /> Object editor
                                </div>
                                <ObjectEditor
                                  value={isPlainObject(value) ? value : {}}
                                  onChange={(next) => setLocal((s) => ({ ...s, [k]: next }))}
                                />
                              </div>
                            )}

                            {(kind === 'array' || kind === 'object') && (
                              <details className="mt-3 rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2">
                                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-tp-steel">
                                  JSON preview
                                </summary>
                                <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-tp-surface-code p-3 text-[11px] leading-5 text-emerald-300">
                                  {toJsonText(value)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-tp-hairline bg-tp-surface px-5 py-4">
          <button
            type="button"
            onClick={handleReset}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong px-4 py-2.5 text-sm font-medium text-tp-charcoal transition-colors hover:bg-tp-surface"
          >
            Reset
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong px-4 py-2.5 text-sm font-medium text-tp-charcoal transition-colors hover:bg-tp-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-semibold text-tp-on-primary shadow-elevation-1 transition-colors hover:bg-tp-primary-deep"
          >
            <span className="inline-flex items-center gap-2"><FaCalculator /> Test</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
