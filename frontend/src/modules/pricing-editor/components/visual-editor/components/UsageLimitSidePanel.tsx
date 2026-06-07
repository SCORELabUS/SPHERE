import { useState } from 'react';
import { motion } from 'framer-motion';
import { SidePanel, Field } from './SidePanel';
import { INPUT_CLS } from '../utils/constants';
import { camelToTitle } from '../../pricing-renderer/shared/stringUtils';

export function UsageLimitSidePanel({ featureKeys, onClose, onSave }: {
  featureKeys: string[];
  onClose: () => void;
  onSave: (data: { name: string; unit: string; linkedFeature: string; type: 'RENEWABLE' | 'NON_RENEWABLE'; defaultValue: number }) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [linkedFeature, setLinkedFeature] = useState('');
  const [ulType, setUlType] = useState<'RENEWABLE' | 'NON_RENEWABLE'>('RENEWABLE');
  const [defaultValue, setDefaultValue] = useState('0');
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedName = name.trim().replace(/\s+/g, '');
    if (!trimmedName) { setError('Name is required'); return; }
    if (!linkedFeature) { setError('Please select a feature to link'); return; }
    setError('');
    onSave({ name: trimmedName, unit: unit.trim() || 'unit', linkedFeature, type: ulType, defaultValue: Number(defaultValue) || 0 });
  };

  return (
    <SidePanel title="Create Usage Limit" onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={handleSave}
          className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Create</button>
      </div>
    }>
      <div className="space-y-5">
        {error && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          >{error}</motion.div>
        )}
        <Field label="Key"><input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="e.g. maxStorage" className={INPUT_CLS} /></Field>
        <Field label="Linked Feature *">
          <select value={linkedFeature} onChange={(e) => { setLinkedFeature(e.target.value); setError(''); }} className={INPUT_CLS}>
            <option value="">Select a feature...</option>
            {featureKeys.map(fk => <option key={fk} value={fk}>{camelToTitle(fk)}</option>)}
          </select>
        </Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. GB, pet, visit" className={INPUT_CLS} /></Field>
        <Field label="Default Value"><input type="number" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label="Limit Type">
          <select value={ulType} onChange={(e) => setUlType(e.target.value as typeof ulType)} className={INPUT_CLS}>
            <option value="RENEWABLE">RENEWABLE</option>
            <option value="NON_RENEWABLE">NON_RENEWABLE</option>
          </select>
        </Field>
      </div>
    </SidePanel>
  );
}
