import Iconify from '../../../../core/components/iconify';
import { OrgMemberWithUser } from '../../../api/organizationsApi';

interface Props {
  /** Who the page is shown as. */
  kind: 'member' | 'visitor';
  orgName: string;
  /** The plain members it can also be shown as, one by one. */
  members: OrgMemberWithUser[];
  /** The member it is shown as, when `kind` is `member`; null for any plain member. */
  asMember: OrgMemberWithUser | null;
  /** Shows it as that member, or as any plain member with null. */
  onViewAsMember: (userId: string | null) => void;
  onViewAsVisitor: () => void;
  onExit: () => void;
}

const segment = (active: boolean) =>
  `flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-tp-ink text-tp-canvas' : 'text-tp-slate hover:text-tp-ink'
  }`;

/**
 * Tells an owner or admin that the page shows their organization as someone
 * else sees it, lets them switch between a member (any plain member, or one of
 * them in particular) and a visitor, and takes them back. It lives in the
 * sticky tab bar, so it stays in sight however far the page scrolls.
 */
export default function ViewAsBanner({ kind, orgName, members, asMember, onViewAsMember, onViewAsVisitor, onExit }: Props) {
  return (
    <div role="status" className="border-b border-tp-beige-deep bg-tp-cream">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-8">
        <Iconify icon="mdi:eye-outline" width={16} className="shrink-0 text-tp-ink" />
        <span className="text-sm font-semibold text-tp-ink">Viewing as</span>
        <div role="group" aria-label="View as" className="flex rounded-lg border border-tp-beige-deep bg-tp-canvas p-0.5">
          <button
            type="button"
            aria-pressed={kind === 'member'}
            title="What any of its members sees"
            onClick={() => kind !== 'member' && onViewAsMember(null)}
            className={segment(kind === 'member')}
          >
            Member
          </button>
          <button
            type="button"
            aria-pressed={kind === 'visitor'}
            title="What anyone outside it sees"
            onClick={() => kind !== 'visitor' && onViewAsVisitor()}
            className={segment(kind === 'visitor')}
          >
            Visitor
          </button>
        </div>
        {kind === 'member' && (
          <select
            aria-label="Member to view as"
            value={asMember?.user.id ?? ''}
            onChange={event => onViewAsMember(event.target.value || null)}
            className="max-w-48 cursor-pointer truncate rounded-lg border border-tp-beige-deep bg-tp-canvas px-2 py-1 text-xs font-medium text-tp-ink focus:border-tp-primary focus:outline-none"
          >
            <option value="">Any member</option>
            {members.map(member => (
              <option key={member.user.id} value={member.user.id}>
                @{member.user.username}
              </option>
            ))}
          </select>
        )}
        <p className="min-w-0 flex-1 text-sm text-tp-slate">
          {kind === 'visitor'
            ? `What people outside ${orgName} see.`
            : asMember
              ? `What @${asMember.user.username} sees of ${orgName}, with their own permissions.`
              : `What any member of ${orgName} sees, with no permissions of their own.`}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-tp-beige-deep bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:border-tp-primary hover:text-tp-primary"
        >
          <Iconify icon="mdi:eye-off-outline" width={14} />
          Exit preview
        </button>
      </div>
    </div>
  );
}
