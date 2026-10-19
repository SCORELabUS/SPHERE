import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MdCheckCircle,
  MdCancel,
  MdSkipNext,
  MdRadioButtonUnchecked,
  MdWarningAmber,
  MdExpandMore,
  MdLink,
  MdContentCopy,
  MdInsertDriveFile,
} from 'react-icons/md';
import type { OrbitPlan, OrbitStepStatus } from '../types/orbit';
import { buildPlanTree, countSteps, deletesSomething, type PlanTreeNode } from '../utils/plan-tree';

interface Props {
  plan: OrbitPlan;
  /** Index of the step being applied right now, while the plan runs. */
  runningIndex: number | null;
  busy: boolean;
  onConfirm: (planId: string, confirmation?: string) => void;
  onCancel: (planId: string) => void;
}

const normalizePhrase = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const STATUS_LABELS: Record<OrbitPlan['status'], string> = {
  PENDING: 'Waiting for your confirmation',
  EXECUTING: 'Applying…',
  COMPLETED: 'Applied',
  PARTIAL: 'Partly applied',
  FAILED: 'Not applied',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Replaced by a newer plan',
};

const STATUS_STYLES: Record<OrbitPlan['status'], string> = {
  PENDING: 'bg-tp-cream text-tp-primary',
  EXECUTING: 'bg-tp-severity-info-bg text-tp-severity-info',
  COMPLETED: 'bg-tp-severity-success-bg text-tp-severity-success',
  PARTIAL: 'bg-tp-severity-warning-bg text-tp-severity-warning',
  FAILED: 'bg-tp-severity-error-bg text-tp-severity-error',
  CANCELLED: 'bg-tp-hairline-soft text-tp-steel',
  SUPERSEDED: 'bg-tp-hairline-soft text-tp-steel',
};

export default function PlanCard({ plan, runningIndex, busy, onConfirm, onCancel }: Props) {
  const tree = useMemo(() => buildPlanTree(plan), [plan]);
  const counts = countSteps(plan);
  const [showSteps, setShowSteps] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [typed, setTyped] = useState('');
  const phrase = plan.confirmationPhrase ?? null;
  const deleting = deletesSomething(plan);
  // Plans that are hard to undo wait until the user has typed what they name.
  const phraseMatches = !phrase || normalizePhrase(typed) === normalizePhrase(phrase);
  const inactive = plan.status === 'CANCELLED' || plan.status === 'SUPERSEDED';
  const finished = ['COMPLETED', 'PARTIAL', 'FAILED'].includes(plan.status);
  const progress = plan.status === 'EXECUTING' ? counts.done + counts.failed + counts.skipped : counts.total;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mt-2 w-full max-w-[560px] overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas text-left shadow-elevation-2 ${inactive ? 'opacity-60' : ''}`}
    >
      {/* Header */}
      <div className="border-b border-tp-hairline-soft bg-tp-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-tp-steel">Plan</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[plan.status]}`}>
            {STATUS_LABELS[plan.status]}
          </span>
          {plan.source === 'file' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-tp-hairline-soft px-2 py-0.5 text-[11px] text-tp-slate">
              <MdInsertDriveFile size={12} /> From a file
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] font-medium text-tp-ink">{plan.summary}</p>
      </div>

      {/* Progress */}
      {(plan.status === 'EXECUTING' || finished) && (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-tp-hairline-soft">
            <motion.div
              className={`h-full ${counts.failed > 0 ? 'bg-tp-severity-warning' : 'bg-tp-primary'}`}
              initial={false}
              animate={{ width: `${counts.total ? (progress / counts.total) * 100 : 0}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-tp-steel">
            {plan.status === 'EXECUTING'
              ? `Step ${Math.min(progress + 1, counts.total)} of ${counts.total}`
              : `${counts.done} of ${counts.total} steps done${counts.failed ? ` · ${counts.failed} failed` : ''}${counts.skipped ? ` · ${counts.skipped} skipped` : ''}`}
          </p>
        </div>
      )}

      {/* Resulting tree */}
      <div className="max-h-[360px] overflow-y-auto px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
        <ul className="space-y-1">
          {tree.map(node => (
            <TreeNode key={node.key} node={node} depth={0} />
          ))}
        </ul>
      </div>

      {/* Warnings */}
      {plan.warnings.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl border border-tp-severity-warning-border bg-tp-severity-warning-bg px-3 py-2">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-tp-severity-warning">
            <MdWarningAmber size={14} /> Review before confirming
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-tp-ink-tint">
            {plan.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Ignored rows */}
      {plan.ignoredRows.length > 0 && (
        <Collapsible
          open={showIgnored}
          onToggle={() => setShowIgnored(open => !open)}
          label={`${plan.ignoredRows.length} row${plan.ignoredRows.length === 1 ? '' : 's'} of the file left out`}
        >
          <ul className="space-y-0.5 text-[12px] text-tp-slate">
            {plan.ignoredRows.map(row => (
              <li key={row.row}>
                <span className="font-medium text-tp-ink">Row {row.row}:</span> {row.reason}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {/* Steps */}
      <Collapsible
        open={showSteps || plan.status === 'EXECUTING'}
        onToggle={() => setShowSteps(open => !open)}
        label={`${counts.total} step${counts.total === 1 ? '' : 's'}`}
      >
        <ol className="space-y-1">
          {plan.steps.map((step, index) => (
            <li key={step.id} className="flex items-start gap-2 text-[12px]">
              <StepIcon status={step.status} running={runningIndex === index} />
              <div className="min-w-0">
                <span className={step.status === 'SKIPPED' ? 'text-tp-stone' : 'text-tp-ink-tint'}>
                  {step.description}
                </span>
                {step.error && <p className="text-[11px] text-tp-severity-error">{step.error}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Collapsible>

      {/* Actions */}
      {plan.status === 'PENDING' && phrase && (
        <div className="border-t border-tp-hairline-soft px-4 py-3">
          <label htmlFor={`confirm-${plan.id}`} className="block text-[12px] text-tp-slate">
            {deleting ? 'Deleting cannot be undone.' : 'This cannot be undone by you.'} Type{' '}
            <strong className="text-tp-ink">{phrase}</strong> to confirm.
          </label>
          <input
            id={`confirm-${plan.id}`}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && phraseMatches && !busy) onConfirm(plan.id, typed);
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder={phrase}
            className="mt-1.5 w-full rounded-lg border border-tp-hairline bg-tp-canvas px-2.5 py-1.5 text-[13px] text-tp-ink outline-none transition-colors placeholder:text-tp-muted focus:border-tp-primary/60"
          />
        </div>
      )}
      {plan.status === 'PENDING' && (
        <div className="flex items-center justify-end gap-2 border-t border-tp-hairline-soft bg-tp-surface px-4 py-3">
          <button
            type="button"
            onClick={() => onCancel(plan.id)}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-tp-hairline px-3 py-1.5 text-[12px] font-medium text-tp-slate transition-colors hover:bg-tp-hairline-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(plan.id, phrase ? typed : undefined)}
            disabled={busy || !phraseMatches}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              deleting
                ? 'bg-tp-severity-error text-white hover:bg-red-600'
                : 'bg-tp-primary text-tp-on-primary hover:bg-tp-primary-deep'
            }`}
          >
            {deleting ? 'Delete permanently' : 'Confirm and apply'}
          </button>
        </div>
      )}
    </motion.div>
  );
}

function TreeNode({ node, depth }: { node: PlanTreeNode; depth: number }) {
  return (
    <li>
      <div className="flex items-start gap-2 rounded-lg px-1.5 py-1" style={{ marginLeft: depth * 16 }}>
        {node.isNew ? <StepIcon status={node.status ?? 'PENDING'} /> : <span className="mt-[3px] h-3 w-3 shrink-0 rounded-sm border border-tp-hairline-strong" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-tp-ink">{node.label}</span>
            {node.isNew ? (
              <span className="rounded bg-tp-cream px-1.5 text-[10px] font-semibold uppercase text-tp-primary">new</span>
            ) : (
              !node.account && <span className="text-[10px] uppercase text-tp-stone">existing</span>
            )}
          </div>
          {node.description && <p className="text-[11px] text-tp-steel">{node.description}</p>}
          {node.error && <p className="text-[11px] text-tp-severity-error">{node.error}</p>}

          {node.edits.map((edit, index) => (
            <p key={index} className="text-[11px] text-tp-slate">
              {edit.displayName !== undefined && <>Rename to <strong>{edit.displayName}</strong>. </>}
              {edit.description !== undefined && (edit.description ? <>New description: “{edit.description}”</> : 'Clear the description')}
              {edit.error && <span className="block text-tp-severity-error">{edit.error}</span>}
            </p>
          ))}

          {node.members.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {node.members.map(member => (
                <span
                  key={member.username}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${member.status === 'DONE' ? 'border-tp-severity-success-border text-tp-ink-tint' : 'border-tp-hairline text-tp-slate'}`}
                >
                  @{member.username}
                  <span className={member.role === 'ADMIN' ? 'font-semibold text-tp-primary' : 'text-tp-stone'}>{member.role}</span>
                </span>
              ))}
            </div>
          )}

          {node.invited.length > 0 && (
            <p className="mt-1 text-[11px] text-tp-slate">
              Invite {node.invited.map(user => `@${user.username}`).join(', ')}
            </p>
          )}

          {node.links.map((link, index) => (
            <InvitationLink key={index} link={link} />
          ))}

          {node.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {node.changes.map((change, index) => (
                <li
                  key={index}
                  className={`flex items-start gap-1 text-[11px] ${change.tone === 'danger' ? 'text-tp-severity-error' : 'text-tp-slate'} ${change.status === 'SKIPPED' ? 'opacity-60' : ''}`}
                >
                  {change.status === 'DONE' && <MdCheckCircle size={12} className="mt-[1px] shrink-0 text-tp-severity-success" />}
                  <span>{change.text}</span>
                </li>
              ))}
            </ul>
          )}

          {node.problems.map(problem => (
            <p key={problem} className="text-[11px] text-tp-severity-error">{problem}</p>
          ))}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map(child => (
            <TreeNode key={child.key} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function InvitationLink({ link }: { link: PlanTreeNode['links'][number] }) {
  const [copied, setCopied] = useState(false);
  const url = link.code ? `${window.location.origin}/orgs/join/${link.code}` : null;
  const uses = link.maxUses === null ? 'unlimited uses' : `${link.maxUses} use${link.maxUses === 1 ? '' : 's'}`;

  return (
    <div className="mt-1 text-[11px] text-tp-slate">
      <span className="inline-flex items-center gap-1">
        <MdLink size={13} /> Invitation link · expires in {link.expiresInDays} day{link.expiresInDays === 1 ? '' : 's'} · {uses}
      </span>
      {url && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="mt-0.5 flex cursor-pointer items-center gap-1 rounded-md border border-tp-hairline bg-tp-surface px-2 py-0.5 font-mono text-[11px] text-tp-ink transition-colors hover:border-tp-primary/40"
        >
          <span className="truncate">{url}</span>
          <MdContentCopy size={12} className="shrink-0" />
          {copied && <span className="font-sans text-tp-severity-success">Copied</span>}
        </button>
      )}
      {link.error && <span className="block text-tp-severity-error">{link.error}</span>}
    </div>
  );
}

function StepIcon({ status, running = false }: { status: OrbitStepStatus; running?: boolean }) {
  if (running) {
    return <span className="mt-[2px] h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />;
  }
  switch (status) {
    case 'DONE':
      return <MdCheckCircle size={15} className="mt-[1px] shrink-0 text-tp-severity-success" />;
    case 'FAILED':
      return <MdCancel size={15} className="mt-[1px] shrink-0 text-tp-severity-error" />;
    case 'SKIPPED':
      return <MdSkipNext size={15} className="mt-[1px] shrink-0 text-tp-stone" />;
    default:
      return <MdRadioButtonUnchecked size={15} className="mt-[1px] shrink-0 text-tp-muted" />;
  }
}

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-tp-hairline-soft px-4 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between text-[12px] font-medium text-tp-slate transition-colors hover:text-tp-ink"
      >
        {label}
        <MdExpandMore size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-1 pt-2">{children}</div>}
    </div>
  );
}
