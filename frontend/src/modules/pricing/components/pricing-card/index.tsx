import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import OrgAvatar from '../../../core/components/org-avatar';
import { getCurrency } from '../stats';
import { IoMdAddCircleOutline } from "react-icons/io";

interface PricingEntry {
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string; avatar: string };
  version: string;
  collection: { id: string; name: string; slug: string } | null;
  createdAt: string;
  currency: string;
  analytics: {
    configurationSpaceSize: number;
    minSubscriptionPrice: number;
    maxSubscriptionPrice: number;
  };
}

export interface MenuItem {
  label: string;
  icon?: 'trash' | 'link' | 'plus';
  onClick: (e: React.MouseEvent) => void;
  variant?: 'danger' | 'default';
}

interface Props {
  data: PricingEntry;
  onRemoved?: () => void;
  showMenu?: boolean;
  menuItems?: MenuItem[];
}

export default function PricingCard({ data, showMenu = false, menuItems = [] }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleNavigate = () => {
    const pricingPath = `/pricings/${data.organization.id}/${data.slug}`;
    const collectionSlug = data.collection?.slug || data.collection?.name;

    router.push(
      collectionSlug
        ? `${pricingPath}?collection=${encodeURIComponent(collectionSlug)}`
        : pricingPath
    );
  };

  const symbol = getCurrency(data.currency);
  const configSize = data.analytics?.configurationSpaceSize ?? 0;
  const minPrice = data.analytics?.minSubscriptionPrice ?? 0;
  const maxPrice = data.analytics?.maxSubscriptionPrice ?? 0;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={handleNavigate}
      className="group cursor-pointer rounded-xl border border-tp-hairline bg-tp-canvas p-4 transition-colors hover:border-tp-hairline-strong hover:shadow-elevation-2"
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <OrgAvatar
              name={data.organization.displayName || data.organization.name}
              avatar={data.organization.avatar}
              size={20}
              square
            />
            <span className="truncate text-[11px] text-tp-steel">
              {data.organization.displayName || data.organization.name}
            </span>
            {data.collection?.name && (
              <>
                <span className="text-tp-hairline">/</span>
                <span className="truncate text-[11px] text-tp-steel">{data.collection.name}</span>
              </>
            )}
          </div>
          <h3 className="truncate text-sm font-medium text-tp-ink group-hover:text-tp-primary">
            {data.name}
          </h3>
        </div>

        {showMenu && menuItems.length > 0 && (
          <div ref={menuRef} className="relative" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-6 cursor-pointer items-center justify-center rounded text-tp-muted opacity-0 transition-all hover:bg-tp-surface hover:text-tp-ink group-hover:opacity-100"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-47 rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4">
                {menuItems.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      item.onClick(e);
                      setMenuOpen(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      item.variant === 'danger'
                        ? 'text-red-600 hover:bg-red-50'
                        : 'text-tp-ink hover:bg-tp-surface'
                    }`}
                  >
                    {item.icon === 'trash' && (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    )}
                    {item.icon === 'link' && (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.18a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.374" />
                      </svg>
                    )}
                    {item.icon === 'plus' && (
                      <IoMdAddCircleOutline fill="currentColor" />
                    )}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px] text-tp-steel">
        <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125"
            />
          </svg>
          {configSize.toLocaleString()} configs
        </span>
        <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
          {symbol}
          {minPrice.toFixed(0)}–{symbol}
          {maxPrice.toFixed(0)}
        </span>
        <span className="text-tp-muted">v{data.version}</span>
      </div>
    </motion.div>
  );
}
