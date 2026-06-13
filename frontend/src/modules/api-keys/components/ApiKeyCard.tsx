import { useState } from 'react';
import { ApiKeySummary } from '../api/apiKeysApi';

interface ApiKeyCardProps {
  keyData: ApiKeySummary;
  onRevoke: (keyId: string) => Promise<void>;
  onDelete: (keyId: string) => Promise<void>;
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: 'All',
  MANAGEMENT: 'Management',
  VIEW: 'View Only',
};

export default function ApiKeyCard({ keyData, onRevoke, onDelete }: ApiKeyCardProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleRevoke = async () => {
    setLoading(true);
    try {
      await onRevoke(keyData.id);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onDelete(keyData.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-tp-hairline bg-tp-canvas p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-tp-steel"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
          </svg>
          <span className="font-medium text-tp-ink">{keyData.name}</span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            keyData.revoked
              ? 'bg-red-100 text-red-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {keyData.revoked ? 'Revoked' : 'Active'}
        </span>
      </div>

      <div className="mb-3">
        <code className="rounded bg-tp-surface px-2 py-1 text-sm text-tp-steel">
          {keyData.keyPreview}
        </code>
        {keyData.expiresAt && (
          <span className="ml-2 text-xs text-tp-steel">
            Expires: {new Date(keyData.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {keyData.scopes.map((scope, idx) => (
          <span
            key={`${scope.organizationId}-${idx}`}
            className="rounded-full bg-tp-surface px-2 py-0.5 text-xs text-tp-slate"
          >
            {scope.organizationId.slice(0, 8)}... ({SCOPE_LABELS[scope.scope]})
          </span>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        {!keyData.revoked && (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-tp-hairline px-3 py-1.5 text-sm text-tp-slate transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            Revoke
          </button>
        )}
        {showConfirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-tp-slate">Delete?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="cursor-pointer rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setShowConfirmDelete(false)}
              disabled={loading}
              className="cursor-pointer rounded-lg border border-tp-hairline px-3 py-1.5 text-sm text-tp-slate transition-colors hover:bg-tp-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConfirmDelete(true)}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
