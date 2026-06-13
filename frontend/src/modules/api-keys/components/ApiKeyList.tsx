import { ApiKeySummary } from '../api/apiKeysApi';
import ApiKeyCard from './ApiKeyCard';

interface ApiKeyListProps {
  keys: ApiKeySummary[];
  onRevoke: (keyId: string) => Promise<void>;
  onDelete: (keyId: string) => Promise<void>;
}

export default function ApiKeyList({ keys, onRevoke, onDelete }: ApiKeyListProps) {
  if (keys.length === 0) {
    return (
      <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-8 text-center">
        <svg
          className="mx-auto h-12 w-12 text-tp-steel"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
          />
        </svg>
        <h3 className="mt-3 text-sm font-medium text-tp-ink">No API keys</h3>
        <p className="mt-1 text-sm text-tp-steel">
          Create an API key to access SPHERE programmatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {keys.map((key) => (
        <ApiKeyCard
          key={key.id}
          keyData={key}
          onRevoke={onRevoke}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
