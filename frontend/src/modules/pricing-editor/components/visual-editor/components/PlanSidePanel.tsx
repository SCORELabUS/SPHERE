import { useState } from 'react';
import { SidePanel, Field } from './SidePanel';
import { INPUT_CLS } from '../utils/constants';
import type { DraftPlan } from '../../../services/pricing2yaml';

export function PlanSidePanel({ planKey, plan, currency, onClose, onSave }: {
  planKey: string; plan: DraftPlan; currency: string;
  onClose: () => void; onSave: (key: string, updates: Partial<{ description: string; price: number | string; unit: string }>) => void;
}) {
  const [name, setName] = useState(planKey);
  const [price, setPrice] = useState(String(plan.price ?? 0));
  const [unit, setUnit] = useState(plan.unit ?? '');
  const [description, setDescription] = useState(plan.description ?? '');
  return (
    <SidePanel title="Edit Plan" onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={() => { const p = price === '' ? 0 : Number(price); onSave(name, { price: Number.isNaN(p) ? 0 : p, unit, description }); onClose(); }}
          className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Save</button>
      </div>
    }>
      <div className="space-y-5">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label={`Price (${currency})`}><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT_CLS} /></Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. user/month" className={INPUT_CLS} /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={INPUT_CLS} /></Field>
      </div>
    </SidePanel>
  );
}
