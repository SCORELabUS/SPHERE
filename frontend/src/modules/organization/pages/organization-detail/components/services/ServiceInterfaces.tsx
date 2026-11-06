import { useEffect, useRef } from 'react';
import type { ServiceInterface } from '../../../../api/serviceTreeApi';
import ChannelTag from './ChannelTag';
import { groupByChannel, interfaceCounts, interfaceExtras } from './interfaces';
import { attributeText } from './tree';

const isUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https?:\/\/\S+$/.test(value);

/** A link that shows its address without the scheme, as Helena does. */
function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="cursor-pointer break-all text-tp-primary underline underline-offset-2 hover:opacity-80"
    >
      {href.replace(/^https?:\/\//, '')}
    </a>
  );
}

/**
 * The free fields of an interface. A `quote` is shown as a quote with its
 * `source`; addresses become links; anything else reads "field: value". New
 * fields of the taxonomy show up here without changes.
 */
function Extras({ item }: { item: ServiceInterface }) {
  const extras = interfaceExtras(item);
  const quote = typeof item.quote === 'string' ? item.quote : null;
  const source = isUrl(item.source) ? item.source : null;
  const rest = extras.filter(
    ([key]) => !(quote && key === 'quote') && !(quote && source && key === 'source')
  );

  return (
    <>
      {rest.map(([key, value]) =>
        typeof value === 'string' &&
        !isUrl(value) &&
        ['why', 'note', 'explanation', 'reason'].includes(key) ? (
          <p key={key} className="text-sm text-tp-ink">
            {value}
          </p>
        ) : (
          <p key={key} className="text-xs text-tp-steel">
            <span className="font-mono">{key}</span>:{' '}
            {isUrl(value) ? <SourceLink href={value} /> : attributeText(value)}
          </p>
        )
      )}
      {quote && (
        <blockquote className="border-l-2 border-tp-hairline-strong pl-3 text-sm text-tp-ink">
          “{quote}”
          {source && (
            <>
              {' '}
              <SourceLink href={source} />
            </>
          )}
        </blockquote>
      )}
    </>
  );
}

interface Props {
  interfaces: ServiceInterface[];
  /** The interface picked in the tree, shown highlighted and scrolled to. */
  highlighted: number | null;
}

/** A service's interfaces, by channel, each as a card with what is known of it. */
export default function ServiceInterfaces({ interfaces, highlighted }: Props) {
  const highlightedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  if (!interfaces.length)
    return <p className="text-sm text-tp-steel">No interfaces are recorded for this service.</p>;

  const groups = groupByChannel(interfaces);
  const { pending } = interfaceCounts(interfaces);
  const classified = groups.filter(group => group.channel !== null);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-tp-steel">
        <span>
          <b className="text-tp-ink">{interfaces.length}</b> interfaces
        </span>
        {classified.length > 0 && (
          <span>
            <b className="text-tp-ink">{classified.length}</b>{' '}
            {classified.length === 1 ? 'channel' : 'channels'}:{' '}
            {classified.map(group => group.style.label).join(', ')}
          </span>
        )}
        {(classified.length > 1 || pending > 0) && (
          <span>
            {[classified.length > 1 && 'multichannel', pending > 0 && 'provisional (pending items)']
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {pending > 0 && (
          <span>
            <b className="text-tp-ink">{pending}</b> pending
          </span>
        )}
      </div>

      {groups.map(group => (
        <section key={group.channel ?? 'unclassified'} className="grid gap-2">
          <h4 className="flex items-center gap-2 font-display text-base text-tp-ink">
            {group.style.label}
            <span className="font-mono text-xs text-tp-steel">{group.items.length}</span>
          </h4>
          <ul className="grid gap-2">
            {group.items.map(({ item, index }) => (
              <li
                key={index}
                ref={index === highlighted ? highlightedRef : undefined}
                className={`grid gap-1.5 rounded-xl border p-3 transition-colors ${
                  index === highlighted
                    ? 'border-tp-primary/50 bg-tp-primary/5'
                    : 'border-tp-hairline'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ChannelTag channel={item.channel} />
                  <span className="font-semibold text-tp-ink">{item.name}</span>
                  {item.pending && (
                    <span className="rounded-full border border-dashed border-tp-hairline-strong px-1.5 text-[10px] font-medium uppercase text-tp-steel">
                      Pending
                    </span>
                  )}
                </div>
                {item.description && <p className="text-sm text-tp-steel">{item.description}</p>}
                {item.mechanisms.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.mechanisms.map(mechanism => (
                      <code
                        key={mechanism}
                        className="rounded-md border border-tp-hairline bg-tp-surface px-1.5 py-0.5 font-mono text-xs text-tp-ink"
                      >
                        {mechanism}
                      </code>
                    ))}
                  </div>
                )}
                <Extras item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
