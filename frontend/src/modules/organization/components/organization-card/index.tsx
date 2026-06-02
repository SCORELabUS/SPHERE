import { motion } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import OrgAvatar from '../../../core/components/org-avatar';

interface OrganizationCardData {
  id: string;
  name: string;
  displayName: string;
  avatar?: string | null;
  avatarBgColor?: string;
  avatarFgColor?: string;
  isPersonal: boolean;
  role?: string;
  subOrganizations?: { id: string }[];
}

interface Props {
  org: OrganizationCardData;
}

export default function OrganizationCard({ org }: Props) {
  const router = useRouter();

  const subOrgCount = org.subOrganizations?.length ?? 0;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={() => router.push(`/orgs/${org.id}`)}
      className="group cursor-pointer rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4 transition-colors hover:border-tp-hairline-strong hover:shadow-elevation-2"
    >
      <div className="mb-3 flex items-center gap-3">
        <OrgAvatar
          name={org.displayName || org.name}
          avatar={org.avatar}
          avatarBgColor={org.avatarBgColor}
          avatarFgColor={org.avatarFgColor}
          isPersonal={org.isPersonal}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-tp-ink group-hover:text-tp-primary">
            {org.displayName || org.name}
          </h3>
          <p className="truncate text-[11px] text-tp-steel">
            @{org.name}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-tp-steel">
        <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
          {org.isPersonal ? 'Personal' : 'Team'}
        </span>
        {subOrgCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            {subOrgCount} {subOrgCount === 1 ? 'sub-org' : 'sub-orgs'}
          </span>
        )}
      </div>
    </motion.div>
  );
}
