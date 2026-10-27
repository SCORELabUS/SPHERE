import { useState } from 'react';
import { MdSmartToy } from 'react-icons/md';
import Iconify from '../../core/components/iconify';

/** Where assistants reach ORBIT: the API's own origin when it is served under the same one. */
function mcpUrl(): string {
  const api = String(import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');
  const base = api.startsWith('http') ? api : `${window.location.origin}${api}`;
  return `${base}/orbit/mcp`;
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-tp-slate">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-tp-surface px-2.5 py-1.5 text-xs text-tp-ink">{value}</code>
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
          aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
          className="cursor-pointer shrink-0 rounded-md border border-tp-hairline p-1.5 text-tp-slate transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink"
        >
          <Iconify icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
        </button>
      </div>
    </div>
  );
}

/** How to plug an assistant such as Claude into ORBIT with one of these keys. */
export default function McpConnectCard() {
  const url = mcpUrl();
  return (
    <section className="mb-8 rounded-lg border border-tp-hairline bg-tp-canvas p-5">
      <div className="mb-3 flex items-center gap-2">
        <MdSmartToy size={20} className="text-tp-primary" />
        <h2 className="text-base font-semibold text-tp-ink">Use ORBIT from an AI assistant (MCP)</h2>
      </div>
      <p className="mb-4 text-sm text-tp-steel">
        Assistants such as Claude or your IDE can use ORBIT&apos;s tools with one of your API keys. They see only what the
        key&apos;s scopes allow, and every change they propose waits for you as a plan in ORBIT, where you confirm it.
        A key with only VIEW scopes can read but not propose changes.
      </p>
      <div className="space-y-3">
        <CopyLine label="Server URL" value={url} />
        <CopyLine label="Header" value="x-api-key: YOUR_API_KEY" />
        <CopyLine label="Claude Code" value={`claude mcp add --transport http sphere ${url} --header "x-api-key: YOUR_API_KEY"`} />
      </div>
    </section>
  );
}
