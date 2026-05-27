import { motion } from 'framer-motion';
import Iconify from '../../../../core/components/iconify';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { transitionDefault, cardHover } from '../../../../core/utils/motion-variants';
import { Organization, OrgMemberWithUser, OrganizationInvitation } from '../../../api/organizationsApi';

interface Props {
  org: Organization;
  members: OrgMemberWithUser[];
  pricingsTotal: number;
  collectionsTotal: number;
  invitations: OrganizationInvitation[];
  isPublicView?: boolean;
}

export default function OverviewTab({ org, members, pricingsTotal, collectionsTotal, invitations, isPublicView = false }: Props) {
  const stats = [
    { label: 'Members', value: members.length, icon: 'mdi:account-group-outline', color: 'bg-tp-primary/8 text-tp-primary' },
    { label: 'Sub-organizations', value: org.subOrganizations?.length ?? 0, icon: 'mdi:graph-outline', color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Pricings', value: pricingsTotal, iconComponent: FaFileInvoiceDollar, color: 'bg-blue-50 text-blue-600' },
    { label: 'Collections', value: collectionsTotal, icon: 'mdi:folder-outline', color: 'bg-purple-50 text-purple-600' },
    ...(!isPublicView ? [{ label: 'Invitations', value: invitations.length, icon: 'mdi:link-variant', color: 'bg-amber-50 text-amber-600' }] : []),
    { label: 'Created', value: org.createdAt ? new Date(org.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A', icon: 'mdi:calendar-outline', color: 'bg-tp-surface text-tp-steel', isText: true },
  ];

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <motion.div
            key={stat.label}
            variants={cardHover}
            initial="rest"
            whileHover="hover"
            className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4 transition-shadow hover:shadow-elevation-1"
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.color}`}>
                {'iconComponent' in stat && stat.iconComponent ? (
                  <stat.iconComponent size={18} />
                ) : (
                  <Iconify icon={stat.icon} width={18} />
                )}
              </div>
              <div>
                {stat.isText ? (
                  <p className="text-sm font-medium text-tp-ink">{stat.value}</p>
                ) : (
                  <p className="text-2xl font-semibold text-tp-ink">{stat.value}</p>
                )}
                <p className="text-[11px] text-tp-steel">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
