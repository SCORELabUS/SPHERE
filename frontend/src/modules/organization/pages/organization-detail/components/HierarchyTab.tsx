import { motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import { Organization } from '../../../api/organizationsApi';
import OrgTreeNode from './OrgTreeNode';
import { TreeNode } from '../types';

interface Props {
  org: Organization;
  canManage: boolean;
  hierarchyTree: TreeNode | null;
  expandedTreeIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  onCreateSubOrg: () => void;
}

export default function HierarchyTab({ org, canManage, hierarchyTree, expandedTreeIds, onToggle, onNavigate, onCreateSubOrg }: Props) {
  return (
    <motion.div
      key="children"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Organization Hierarchy</h2>
            <p className="text-xs text-tp-steel">
              {org._parentId
                ? 'Ancestors above, descendants below. Only accessible nodes are shown.'
                : 'This is a root organization. All descendants are shown below.'}
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={onCreateSubOrg}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
            >
              <Iconify icon="mdi:plus" width={16} />
              Add child
            </button>
          )}
        </div>

        <div className="p-3">
          {(!org.subOrganizations || org.subOrganizations.length === 0) && !org._parentId ? (
            <div className="flex flex-col items-center gap-2 py-12 text-tp-ink">
              <Iconify icon="mdi:graph-outline" width={32} />
              <p className="text-sm">No sub-organizations yet.</p>
              {canManage && (
                <button
                  type="button"
                  onClick={onCreateSubOrg}
                  className="mt-1 cursor-pointer text-sm font-medium text-tp-primary hover:underline"
                >
                  Create the first sub-organization
                </button>
              )}
            </div>
          ) : hierarchyTree ? (
            <OrgTreeNode
              node={hierarchyTree}
              expandedIds={expandedTreeIds}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ) : (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-b-tp-primary" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
