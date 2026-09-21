import { useState } from 'react';

export default function PermanentLink({ kind, id }: { kind: 'p' | 'c'; id?: string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  if (!id) return null;
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/${kind}/${id}`;
  return <div className="text-sm">
    <button type="button" className="cursor-pointer text-tp-primary underline focus-visible:outline-2" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setCopied(true); }
      catch { setFallback(true); }
    }}>{copied ? 'Permanent link copied' : 'Copy permanent link'}</button>
    {fallback && <label className="block text-tp-ink">Permanent link<input className="w-full border p-2" readOnly value={url} onFocus={event => event.target.select()} /></label>}
    <span className="sr-only" role="status">{copied ? 'Copied to clipboard' : ''}</span>
  </div>;
}
