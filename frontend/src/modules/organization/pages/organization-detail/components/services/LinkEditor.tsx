import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { ServiceLink, ServiceNode } from '../../../../api/serviceTreeApi';
import { emptyLink, isWebAddress, linkExtras } from './links';
import { inputClass } from './ServiceNodePanels';

const iconButton =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-30';

interface Props {
  node: ServiceNode;
  nodes: ServiceNode[];
  /** `field` names what was typed into, so typing on in it is one undo step. */
  onChange: (links: ServiceLink[], field: string) => void;
}

/** The links of a service in the outline: pages about its terms, to add, describe, reorder and remove. */
export default function LinkEditor({ node, nodes, onChange }: Props) {
  const list = node.links;
  const topicsId = useId();
  // The topics the tree already uses, offered while typing one.
  const topics = useMemo(
    () => [
      ...new Set(
        nodes.flatMap(n => n.links.map(link => link.topic)).filter((t): t is string => !!t)
      ),
    ],
    [nodes]
  );
  const [focusLast, setFocusLast] = useState(false);
  const lastUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusLast) return;
    lastUrlRef.current?.focus();
    setFocusLast(false);
  }, [focusLast, list.length]);

  const change = (index: number, changes: Partial<ServiceLink>, field: string) =>
    onChange(
      list.map((link, at) => (at === index ? { ...link, ...changes } : link)),
      `link:${index}:${field}`
    );

  const move = (index: number, direction: -1 | 1) => {
    const next = [...list];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next, 'links');
  };

  return (
    <div className="grid gap-2">
      <datalist id={topicsId}>
        {topics.map(topic => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
      {list.length === 0 && (
        <p className="text-xs text-tp-steel">
          No links yet: pages that answer questions about the service&apos;s terms (refunds,
          cancellation, SLA, data retention...).
        </p>
      )}
      {list.map((link, index) => {
        const extras = linkExtras(link);
        const valid = isWebAddress(link.url);
        return (
          <div
            key={index}
            className="grid gap-1.5 rounded-xl border border-tp-hairline bg-tp-canvas p-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
              <Iconify icon="mdi:link-variant" width={16} className="shrink-0 text-tp-steel" />
              <input
                ref={index === list.length - 1 ? lastUrlRef : undefined}
                type="url"
                value={link.url}
                maxLength={2000}
                placeholder="https://example.com/terms#refunds"
                aria-label="Link address"
                aria-invalid={!valid}
                onChange={e => change(index, { url: e.target.value }, 'url')}
                className={`${inputClass} min-w-[10rem] flex-1 py-1.5 font-mono text-xs ${valid ? '' : 'border-tp-severity-error/60'}`}
              />
              {valid && (
                <a
                  href={link.url.trim()}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Open the link"
                  title="Open the link"
                  className={iconButton}
                >
                  <Iconify icon="mdi:open-in-new" width={15} />
                </a>
              )}
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className={iconButton}
              >
                <Iconify icon="mdi:arrow-up" width={15} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === list.length - 1}
                aria-label="Move down"
                className={iconButton}
              >
                <Iconify icon="mdi:arrow-down" width={15} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    list.filter((_, at) => at !== index),
                    'links'
                  )
                }
                aria-label={`Remove ${link.title || link.url || 'the link'}`}
                className={`${iconButton} hover:!bg-tp-severity-error-bg hover:!text-tp-severity-error`}
              >
                <Iconify icon="mdi:trash-can-outline" width={15} />
              </button>
            </div>
            {!valid && (
              <p className="text-[11px] text-tp-severity-error">
                {link.url.trim()
                  ? 'Write the full address, starting with https:// or http://'
                  : 'Write the address of the page'}
              </p>
            )}
            <div className="grid gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <input
                value={link.title}
                maxLength={200}
                placeholder="Title (optional), e.g. Refund policy"
                aria-label="Link title"
                onChange={e => change(index, { title: e.target.value }, 'title')}
                className={`${inputClass} py-1.5 text-xs`}
              />
              <input
                value={link.topic ?? ''}
                maxLength={40}
                list={topicsId}
                placeholder="Topic, e.g. Refunds"
                aria-label="Link topic"
                onChange={e => change(index, { topic: e.target.value || null }, 'topic')}
                className={`${inputClass} py-1.5 text-xs`}
              />
            </div>
            <input
              value={link.description}
              maxLength={1000}
              placeholder="The question it answers (optional), e.g. Can I get my money back?"
              aria-label="Link description"
              onChange={e => change(index, { description: e.target.value }, 'description')}
              className={`${inputClass} py-1.5 text-xs`}
            />
            {extras.length > 0 && (
              <p className="text-[11px] text-tp-steel">
                Other fields:{' '}
                <span className="font-mono">{extras.map(([key]) => key).join(', ')}</span> (changed
                in JSON)
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          onChange([...list, emptyLink(list[list.length - 1]?.topic ?? null)], 'links');
          setFocusLast(true);
        }}
        className="flex cursor-pointer items-center gap-1.5 justify-self-start rounded-lg px-2 py-1.5 text-xs font-medium text-tp-steel transition-colors hover:bg-tp-canvas hover:text-tp-ink"
      >
        <Iconify icon="mdi:plus" width={15} />
        Add a link
      </button>
    </div>
  );
}
