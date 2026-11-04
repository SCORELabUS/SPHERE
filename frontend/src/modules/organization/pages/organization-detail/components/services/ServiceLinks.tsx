import { type ReactNode, useEffect, useRef } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { ServiceLink } from '../../../../api/serviceTreeApi';
import { groupByTopic, hostOf, isWebAddress, linkExtras, linkLabel } from './links';
import { attributeText } from './tree';

/** Opens outside SPHERE, without handing it this page. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isWebAddress(href)) return <span className="break-all">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex cursor-pointer items-baseline gap-1 break-words text-tp-primary underline-offset-2 hover:underline"
    >
      {children}
      <Iconify icon="mdi:open-in-new" width={13} className="shrink-0 self-center" />
    </a>
  );
}

interface Props {
  links: ServiceLink[];
  /** The link picked in the tree, shown highlighted and scrolled to. */
  highlighted: number | null;
}

/** A service's links: pages that answer questions about its terms, by topic. */
export default function ServiceLinks({ links, highlighted }: Props) {
  const highlightedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  if (!links.length)
    return (
      <p className="text-sm text-tp-steel">
        No links yet. Links point to pages that answer questions about the service&apos;s terms.
      </p>
    );

  const groups = groupByTopic(links);
  const withTopics = groups.some(group => group.topic !== null);

  return (
    <div className="grid gap-5">
      {groups.map(group => (
        <section key={group.topic ?? '__none__'} className="grid gap-2">
          {withTopics && (
            <h4 className="flex items-center gap-2 font-display text-base text-tp-ink">
              {group.topic ?? 'Other'}
              <span className="font-mono text-xs text-tp-steel">{group.items.length}</span>
            </h4>
          )}
          <ul className="grid gap-2">
            {group.items.map(({ link, index }) => (
              <li
                key={index}
                ref={index === highlighted ? highlightedRef : undefined}
                className={`grid gap-1 rounded-xl border p-3 transition-colors ${
                  index === highlighted
                    ? 'border-tp-primary/50 bg-tp-primary/5'
                    : 'border-tp-hairline'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-semibold">
                    <ExternalLink href={link.url}>{linkLabel(link)}</ExternalLink>
                  </span>
                  {/* An untitled link is already named after its site. */}
                  {link.title.trim() && (
                    <span className="font-mono text-[11px] text-tp-steel">{hostOf(link.url)}</span>
                  )}
                </div>
                {link.description && <p className="text-sm text-tp-steel">{link.description}</p>}
                {linkExtras(link).map(([key, value]) => (
                  <p key={key} className="text-xs text-tp-steel">
                    <span className="font-mono">{key}</span>:{' '}
                    {typeof value === 'string' && isWebAddress(value) ? (
                      <ExternalLink href={value}>{value.replace(/^https?:\/\//, '')}</ExternalLink>
                    ) : (
                      attributeText(value)
                    )}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
