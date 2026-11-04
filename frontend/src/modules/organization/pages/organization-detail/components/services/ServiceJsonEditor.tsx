import { useState } from 'react';
import Iconify from '../../../../../core/components/iconify';

interface Props {
  text: string;
  errors: string[];
  readOnly: boolean;
  onChange: (text: string) => void;
}

const toolButton =
  'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-40';

/** The tree as JSON text: read-only to browse it, or edited, where every valid change reaches the tree at once. */
export default function ServiceJsonEditor({ text, errors, readOnly, onChange }: Props) {
  const [copied, setCopied] = useState(false);
  const valid = errors.length === 0;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      // Only valid JSON is formatted; the errors already say what is wrong.
    }
  };

  return (
    <div className="grid gap-2">
      <div className="overflow-hidden rounded-xl border border-tp-hairline focus-within:border-tp-primary">
        <div className="flex flex-wrap items-center gap-2 border-b border-tp-hairline bg-tp-surface px-3 py-1.5">
          <span className="font-mono text-xs font-semibold text-tp-slate">services.json</span>
          {readOnly ? (
            <span className="text-xs text-tp-steel">Read only</span>
          ) : valid ? (
            <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Iconify icon="mdi:check" width={14} /> Valid, the tree follows it
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-tp-severity-error">
              {errors.length === 1 ? '1 error' : `${errors.length} errors`}, the tree keeps the last valid version
            </span>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {!readOnly && (
              <button type="button" onClick={format} disabled={!valid} className={toolButton}>
                Format
              </button>
            )}
            <button type="button" onClick={copy} className={toolButton}>
              <Iconify icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={14} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <textarea
          value={text}
          readOnly={readOnly}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          wrap="off"
          aria-label="Services as JSON"
          aria-invalid={!valid}
          className="block h-[28rem] w-full resize-y bg-tp-canvas p-3 font-mono text-[13px] leading-5 text-tp-ink focus:outline-none md:h-[calc(100vh-22rem)] md:min-h-[24rem]"
        />
      </div>

      {!valid && (
        <ul className="grid gap-1 rounded-lg border border-tp-severity-error/30 bg-tp-severity-error-bg px-3 py-2 text-xs text-tp-severity-error">
          {errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-5 text-tp-steel">
        Each service needs a <code className="font-mono">name</code>. Everything else is optional:{' '}
        <code className="font-mono">kind</code> (autonomous, dependent or any new type, like "Add-on"),{' '}
        <code className="font-mono">dependency</code> (functional, account or anything else),{' '}
        <code className="font-mono">description</code>, <code className="font-mono">pricings</code> (their slugs) and the{' '}
        <code className="font-mono">services</code> inside it. Leave the <code className="font-mono">id</code> out of a new
        service to get one. Any other field, like <code className="font-mono">"customers": ["Acme"]</code>, is kept with the
        service and shown in its details.
      </p>
    </div>
  );
}
