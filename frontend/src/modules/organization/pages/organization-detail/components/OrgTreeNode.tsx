import { AnimatePresence, motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import OrgAvatar from '../../../../core/components/org-avatar';
import { TreeNode } from '../types';

interface Props {
  node: TreeNode;
  level?: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
}

export default function OrgTreeNode({ node, level = 0, expandedIds, onToggle, onNavigate }: Props) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);

  return (
    <div>
      <div
        className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
          node.isCurrent
            ? 'bg-tp-primary/8 ring-1 ring-tp-primary/20'
            : node.hasAccess
              ? 'hover:bg-tp-surface cursor-pointer'
              : 'opacity-60'
        }`}
        style={{ paddingLeft: `${level * 24 + 12}px` }}
        onClick={() => {
          if (node.hasAccess && !node.isCurrent) {
            onNavigate(node.id);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-tp-steel transition-colors hover:bg-tp-hairline"
          >
            <Iconify icon={isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'} width={14} />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <OrgAvatar
          name={node.name}
          avatar={node.avatar}
          size={28}
          square
        />

        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${node.isCurrent ? 'font-semibold text-tp-ink' : 'font-medium text-tp-ink'}`}>
            {node.displayName}
            {node.isCurrent && <span className="ml-2 text-[11px] text-tp-primary">(current)</span>}
          </p>
        </div>

        {!node.hasAccess && (
          <Iconify icon="mdi:lock-outline" width={14} className="shrink-0 text-tp-ink" />
        )}

        {node.isAncestor && (
          <span className="shrink-0 rounded bg-tp-surface px-1.5 py-0.5 text-[10px] font-medium text-tp-steel">ancestor</span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <OrgTreeNode
                key={child.id}
                node={child}
                level={level + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
