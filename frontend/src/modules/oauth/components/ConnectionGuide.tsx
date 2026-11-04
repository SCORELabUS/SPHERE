import { useEffect, useRef, useState } from 'react';
import { FiArrowUpRight, FiCheck, FiCopy, FiX } from 'react-icons/fi';
import { assistantNames, mcpServerUrl, type Assistant } from '../utils/connections';

export default function ConnectionGuide({ assistant, onClose, onRefresh, checking }: {
  assistant: Assistant; onClose: () => void; onRefresh: () => void; checking: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const url = mcpServerUrl(String(import.meta.env.VITE_API_URL || '/api/v1'), window.location.origin);
  useEffect(() => { title.current?.focus(); }, [assistant]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  const docs = assistant === 'claude'
    ? 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'
    : 'https://learn.chatgpt.com/docs/extend/mcp';
  return <section aria-labelledby="connect-guide-title" className="rounded-xl border border-tp-hairline bg-tp-surface p-5 sm:p-6">
    <div className="flex items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-tp-primary">Connect with OAuth</p>
        <h3 ref={title} tabIndex={-1} id="connect-guide-title" className="text-lg font-semibold text-tp-ink outline-none">Connect {assistantNames[assistant]} to SPHERE</h3></div>
      <button type="button" aria-label="Close connection guide" onClick={onClose} className="cursor-pointer rounded-md p-2 text-tp-steel hover:bg-tp-canvas focus-visible:outline-2 focus-visible:outline-tp-primary"><FiX size={18} /></button>
    </div>
    <p className="mt-2 text-sm leading-relaxed text-tp-steel">Start in your assistant, then sign in to SPHERE to choose organizations and access levels. You only need this server URL.</p>
    <div className="mt-5 flex items-start gap-2 rounded-lg border border-tp-hairline bg-tp-canvas p-3">
      <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-medium text-tp-steel">MCP server URL</p><code className="block select-all break-all text-sm text-tp-ink">{url}</code></div>
      <button type="button" onClick={copy} aria-label="Copy server URL" className="flex cursor-pointer items-center gap-2 rounded-md border border-tp-hairline px-3 py-2 text-sm text-tp-ink hover:bg-tp-surface focus-visible:outline-2 focus-visible:outline-tp-primary">{copied ? <FiCheck /> : <FiCopy />}<span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span></button>
    </div>
    {copyError && <p role="alert" className="mt-2 text-xs text-tp-steel">Copy is unavailable. Select the URL above to copy it manually.</p>}
    <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-tp-slate">
      {assistant === 'claude' ? <>
        <li>In Claude, open <strong>Customize → Connectors → Add custom connector</strong>. On a team, your administrator may need to add it first.</li>
        <li>Name it <strong>SPHERE</strong>, paste the URL, and use OAuth sign-in. If prompted for an OAuth client, choose <strong>Register automatically</strong>.</li>
      </> : <>
        <li>In Codex, open <strong>Settings → MCP servers → Add server</strong>. Choose <strong>Streamable HTTP</strong>, name it <strong>SPHERE</strong> and paste the URL.</li>
        <li>Save and restart the server, then select <strong>Authenticate</strong>. In ChatGPT, add the URL as a custom MCP connection in your workspace&apos;s Apps or developer settings.</li>
      </>}
      <li>Approve access in SPHERE, choosing the organizations and levels your assistant needs. Return here to manage the connection.</li>
    </ol>
    {assistant === 'openai' && <details className="mt-5 text-sm text-tp-slate"><summary className="cursor-pointer font-medium">Using the Codex CLI?</summary><pre className="mt-2 overflow-x-auto rounded-lg border border-tp-hairline bg-tp-canvas p-3 text-xs text-tp-ink">{`codex mcp add sphere --url ${url}\ncodex mcp login sphere`}</pre></details>}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <a href={docs} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center gap-1 text-sm text-tp-primary underline underline-offset-4">Official setup guide <FiArrowUpRight /></a>
      <button type="button" onClick={onRefresh} disabled={checking} className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary hover:bg-tp-primary-deep disabled:opacity-50">{checking ? 'Checking…' : 'Check connection'}</button>
    </div>
    <p className="mt-4 text-xs leading-relaxed text-tp-steel">The server must be publicly reachable for cloud assistants. Your workspace may restrict custom connections.</p>
  </section>;
}
