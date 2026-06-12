import { useState } from 'react';
import { SidePanel, Field } from './SidePanel';
import { INPUT_CLS } from '../utils/constants';
import type { DraftAddOn } from '../../../services/pricing2yaml';

export function AddOnSidePanel({
  addOnKey, addOn, planKeys, addOnKeys, featureKeys, usageLimitKeys, currency, onClose, onSave,
}: {
  addOnKey: string; addOn: DraftAddOn;
  planKeys: string[]; addOnKeys: string[]; featureKeys: string[]; usageLimitKeys: string[];
  currency: string;
  onClose: () => void;
  onSave: (key: string, updates: Partial<DraftAddOn>) => void;
}) {
  const [name, setName] = useState(addOnKey);
  const [description, setDescription] = useState(addOn.description ?? '');
  const [price, setPrice] = useState(String(addOn.price ?? 0));
  const [unit, setUnit] = useState(addOn.unit ?? '');
  const [privatePlan, setPrivate] = useState(addOn.private ?? false);
  const [availableFor, setAvailableFor] = useState<string[]>(addOn.availableFor ?? planKeys);
  const [dependsOn, setDependsOn] = useState<string[]>(addOn.dependsOn ?? []);
  const [excludes, setExcludes] = useState<string[]>(addOn.excludes ?? []);
  const [minQty, setMinQty] = useState(String(addOn.subscriptionConstraints?.min ?? 1));
  const [maxQty, setMaxQty] = useState(String(addOn.subscriptionConstraints?.max ?? 1));
  const [stepQty, setStepQty] = useState(String(addOn.subscriptionConstraints?.step ?? 1));

  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(addOn.features ?? {}).map(([k, v]) => [k, String(v.value)]))
  );
  const [usageValues, setUsageValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(addOn.usageLimits ?? {}).map(([k, v]) => [k, String(v.value)]))
  );
  const [extensionValues, setExtensionValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(addOn.usageLimitsExtensions ?? {}).map(([k, v]) => [k, String(v.value)]))
  );

  const toggleArray = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];

  const handleSave = () => {
    const p = price === '' ? 0 : Number(price);
    const features: Record<string, { value: string | number | boolean }> = {};
    for (const [k, v] of Object.entries(featureValues)) {
      if (v !== '') features[k] = { value: v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v) };
    }
    const usageLimits: Record<string, { value: string | number | boolean }> = {};
    for (const [k, v] of Object.entries(usageValues)) {
      if (v !== '') usageLimits[k] = { value: Number.isNaN(Number(v)) ? v : Number(v) };
    }
    const usageLimitsExtensions: Record<string, { value: string | number | boolean }> = {};
    for (const [k, v] of Object.entries(extensionValues)) {
      if (v !== '') usageLimitsExtensions[k] = { value: Number.isNaN(Number(v)) ? v : Number(v) };
    }
    onSave(name, {
      description: description || undefined,
      price: Number.isNaN(p) ? 0 : p,
      unit: unit || undefined,
      private: privatePlan || undefined,
      availableFor: availableFor.length === planKeys.length ? undefined : availableFor,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      excludes: excludes.length > 0 ? excludes : undefined,
      subscriptionConstraints: { min: Number(minQty) || 1, max: Number(maxQty) || 1, step: Number(stepQty) || 1 },
      features: Object.keys(features).length > 0 ? features : undefined,
      usageLimits: Object.keys(usageLimits).length > 0 ? usageLimits : undefined,
      usageLimitsExtensions: Object.keys(usageLimitsExtensions).length > 0 ? usageLimitsExtensions : undefined,
    });
    onClose();
  };

  const otherAddOnKeys = addOnKeys.filter(k => k !== addOnKey);

  return (
    <SidePanel title="Edit Add-On" onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose}
          className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={handleSave}
          className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Save</button>
      </div>
    }>
      <div className="space-y-5">
        {/* Basic info */}
        <Field label="Key"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT_CLS} /></Field>
        <Field label={`Price (${currency})`}><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. user/month" className={INPUT_CLS} /></Field>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="ao-private" checked={privatePlan} onChange={(e) => setPrivate(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
          <label htmlFor="ao-private" className="text-sm text-slate-700 dark:text-slate-300">Private (hidden from public pricing)</label>
        </div>

        {/* Available for plans */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Available for plans</label>
          <div className="space-y-1">
            {planKeys.map(pk => (
              <label key={pk} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                <input type="checkbox" checked={availableFor.includes(pk)}
                  onChange={() => setAvailableFor(toggleArray(availableFor, pk))}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                {pk}
              </label>
            ))}
          </div>
        </div>

        {/* Dependencies */}
        {otherAddOnKeys.length > 0 && (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Depends on</label>
              <div className="space-y-1">
                {otherAddOnKeys.map(aok => (
                  <label key={aok} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={dependsOn.includes(aok)}
                      onChange={() => setDependsOn(toggleArray(dependsOn, aok))}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    {aok}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Excludes</label>
              <div className="space-y-1">
                {otherAddOnKeys.map(aok => (
                  <label key={aok} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={excludes.includes(aok)}
                      onChange={() => setExcludes(toggleArray(excludes, aok))}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    {aok}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Subscription constraints */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Subscription Constraints</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Min">
              <input type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} min="1" className={INPUT_CLS} />
            </Field>
            <Field label="Max">
              <input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} min="1" className={INPUT_CLS} />
            </Field>
            <Field label="Step">
              <input type="number" value={stepQty} onChange={(e) => setStepQty(e.target.value)} min="1" className={INPUT_CLS} />
            </Field>
          </div>
        </div>

        {/* Feature overrides */}
        {featureKeys.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Feature Overrides</label>
            <div className="space-y-2">
              {featureKeys.map(fk => (
                <div key={fk} className="flex items-center gap-2">
                  <span className="w-32 truncate text-xs text-slate-600 dark:text-slate-400" title={fk}>{fk}</span>
                  <input value={featureValues[fk] ?? ''}
                    onChange={(e) => setFeatureValues(prev => ({ ...prev, [fk]: e.target.value }))}
                    placeholder="value"
                    className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage limit overrides */}
        {usageLimitKeys.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Usage Limit Overrides</label>
            <div className="space-y-2">
              {usageLimitKeys.map(ulk => (
                <div key={ulk} className="flex items-center gap-2">
                  <span className="w-32 truncate text-xs text-slate-600 dark:text-slate-400" title={ulk}>{ulk}</span>
                  <input value={usageValues[ulk] ?? ''}
                    onChange={(e) => setUsageValues(prev => ({ ...prev, [ulk]: e.target.value }))}
                    placeholder="value"
                    className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage limit extensions */}
        {usageLimitKeys.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Usage Limit Extensions</label>
            <div className="space-y-2">
              {usageLimitKeys.map(ulk => (
                <div key={ulk} className="flex items-center gap-2">
                  <span className="w-32 truncate text-xs text-slate-600 dark:text-slate-400" title={ulk}>{ulk}</span>
                  <input value={extensionValues[ulk] ?? ''}
                    onChange={(e) => setExtensionValues(prev => ({ ...prev, [ulk]: e.target.value }))}
                    placeholder="extend by"
                    className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
