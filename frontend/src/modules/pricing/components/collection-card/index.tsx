import { motion } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';

interface CollectionEntry {
  id: string;
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string; avatar: string };
  numberOfPricings: number;
}

interface Props {
  collection: CollectionEntry;
}

export default function CollectionCard({ collection }: Props) {
  const router = useRouter();

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={() => router.push(`/collections/${collection.organization.id}/${collection.slug}`)}
      className="group cursor-pointer rounded-xl border border-tp-hairline bg-tp-canvas p-4 transition-colors hover:border-tp-hairline-strong hover:shadow-elevation-2"
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-tp-cream">
          <svg className="h-4 w-4 text-tp-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-tp-ink group-hover:text-tp-primary">
            {collection.name}
          </h3>
          <p className="text-[11px] text-tp-steel">
            {collection.organization.displayName || collection.organization.name}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-tp-steel">
        <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          {collection.numberOfPricings} {collection.numberOfPricings === 1 ? 'pricing' : 'pricings'}
        </span>
      </div>
    </motion.div>
  );
}
