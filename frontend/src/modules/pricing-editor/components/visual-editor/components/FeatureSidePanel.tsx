import { useState } from 'react';
import { SidePanel, Field } from './SidePanel';
import { INPUT_CLS, FEATURE_TYPES, VALUE_TYPES, USAGE_LIMIT_TYPES } from '../utils/constants';
import type { DraftFeature, DraftUsageLimit } from '../../../services/pricing2yaml';

export function FeatureSidePanel({ entityKey, entity, isFeature, onClose, onSave, onConvert }: {
  entityKey: string; entity: DraftFeature | DraftUsageLimit; isFeature: boolean;
  onClose: () => void;
  onSave: (key: string, updates: Record<string, unknown>) => void;
  onConvert: (key: string, toType: 'feature' | 'usageLimit') => void;
}) {
  const [name, setName] = useState(entityKey);
  const [description, setDescription] = useState(entity.description ?? '');

  const f = isFeature ? entity as DraftFeature : null;
  const [valueType, setValueType] = useState(f?.valueType ?? 'BOOLEAN');
  const [defaultValue, setDefaultValue] = useState(String(f?.defaultValue ?? ''));
  const [featureType, setFeatureType] = useState(f?.type ?? 'DOMAIN');
  const [expression, setExpression] = useState(f?.expression ?? '');

  const u = !isFeature ? entity as DraftUsageLimit : null;
  const [ulValueType, setUlValueType] = useState(u?.valueType ?? 'NUMERIC');
  const [ulDefault, setUlDefault] = useState(String(u?.defaultValue ?? '0'));
  const [unit, setUnit] = useState(u?.unit ?? '');
  const [ulType, setUlType] = useState<'RENEWABLE' | 'NON_RENEWABLE'>(u?.type ?? 'RENEWABLE');

  return (
    <SidePanel title={isFeature ? 'Edit Feature' : 'Edit Usage Limit'} onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={() => {
          if (isFeature) {
            onSave(name, { description, valueType, defaultValue: valueType === 'BOOLEAN' ? defaultValue === 'true' : valueType === 'NUMERIC' ? Number(defaultValue) || 0 : defaultValue, type: featureType, expression: expression || undefined });
          } else {
            onSave(name, { description, valueType: ulValueType, defaultValue: ulValueType === 'NUMERIC' ? Number(ulDefault) || 0 : ulDefault, unit, type: ulType });
          }
          onClose();
        }} className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Save</button>
      </div>
    }>
      <div className="space-y-5">
        <Field label="Key"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT_CLS} /></Field>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Convert to:</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onConvert(entityKey, 'feature')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${isFeature ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-400'}`}
            >Feature</button>
            <button type="button" onClick={() => onConvert(entityKey, 'usageLimit')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!isFeature ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-400'}`}
            >Usage Limit</button>
          </div>
        </div>

        {isFeature ? (
          <>
            <Field label="Value Type">
              <select value={valueType} onChange={(e) => setValueType(e.target.value as typeof valueType)} className={INPUT_CLS}>
                {VALUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Default Value">
              {valueType === 'BOOLEAN' ? (
                <select value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={INPUT_CLS}>
                  <option value="true">true</option><option value="false">false</option>
                </select>
              ) : <input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={INPUT_CLS} />}
            </Field>
            <Field label="Feature Type">
              <select value={featureType} onChange={(e) => setFeatureType(e.target.value)} className={INPUT_CLS}>
                {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Expression (optional)"><input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="pricingContext['features']..." className={INPUT_CLS} /></Field>
          </>
        ) : (
          <>
            <Field label="Value Type">
              <select value={ulValueType} onChange={(e) => setUlValueType(e.target.value as typeof ulValueType)} className={INPUT_CLS}>
                {VALUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Default Value">
              <input type={ulValueType === 'NUMERIC' ? 'number' : 'text'} value={ulDefault} onChange={(e) => setUlDefault(e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. GB, pet, visit" className={INPUT_CLS} /></Field>
            <Field label="Limit Type">
              <select value={ulType} onChange={(e) => setUlType(e.target.value as typeof ulType)} className={INPUT_CLS}>
                {USAGE_LIMIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>
    </SidePanel>
  );
}
