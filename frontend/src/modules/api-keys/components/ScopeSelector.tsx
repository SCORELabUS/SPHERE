import { ApiKeyScope } from '../api/apiKeysApi';
import Iconify from '../../core/components/iconify';

interface Organization {
  id: string;
  name: string;
  displayName: string;
}

interface ScopeSelectorProps {
  organizations: Organization[];
  selectedScopes: ApiKeyScope[];
  onChange: (scopes: ApiKeyScope[]) => void;
}

const SCOPE_OPTIONS = [
  {
    value: 'VIEW' as const,
    label: 'View Only',
    description: 'Read access only',
    icon: 'mdi:eye-outline',
  },
  {
    value: 'MANAGEMENT' as const,
    label: 'Management',
    description: 'Full access to this organization',
    icon: 'mdi:shield-account-outline',
  },
  {
    value: 'ALL' as const,
    label: 'All',
    description: 'Access to this and sub-organizations',
    icon: 'mdi:shield-check-outline',
  },
];

export default function ScopeSelector({
  organizations,
  selectedScopes,
  onChange,
}: ScopeSelectorProps) {
  const getScopeForOrg = (orgId: string): ApiKeyScope['scope'] | null => {
    return selectedScopes.find((s) => s.organizationId === orgId)?.scope ?? null;
  };

  const updateScope = (orgId: string, scope: ApiKeyScope['scope']) => {
    const existing = selectedScopes.filter((s) => s.organizationId !== orgId);
    onChange([...existing, { organizationId: orgId, scope }]);
  };

  if (organizations.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-tp-ink">Access levels</p>
      {organizations.map((org) => {
        const currentScope = getScopeForOrg(org.id);
        return (
          <div
            key={org.id}
            className="rounded-lg border border-tp-hairline bg-tp-surface p-3"
          >
            <p className="mb-2 text-sm font-medium text-tp-ink">{org.displayName}</p>
            <div className="flex gap-1.5">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateScope(org.id, option.value)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    currentScope === option.value
                      ? 'bg-tp-primary text-tp-on-primary'
                      : 'bg-tp-canvas text-tp-slate hover:bg-tp-surface-hover'
                  }`}
                  title={option.description}
                >
                  <Iconify icon={option.icon} width={14} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
