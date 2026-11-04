import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Iconify from '../../../../../core/components/iconify';
import type { ServiceInterface, ServiceNode } from '../../../../api/serviceTreeApi';
import ChannelTag from './ChannelTag';
import { CHANNEL_NAMES, KNOWN_CHANNELS, emptyInterface, interfaceExtras } from './interfaces';
import { Chip, LabelInput, inputClass } from './ServiceNodePanels';
import { useDismiss } from './useDismiss';

const iconButton =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-30';

/** The channel of an interface: the known ones, those the tree already uses, none, or a new one written in. */
function ChannelPicker({
  value,
  used,
  onChange,
}: {
  value: string | null;
  used: string[];
  onChange: (channel: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        title="Channel"
        className="flex cursor-pointer items-center rounded-full transition-opacity hover:opacity-80"
      >
        {value ? (
          <ChannelTag channel={value} full />
        ) : (
          <span className="rounded-full border border-dashed border-tp-hairline-strong px-2 py-0.5 text-[11px] text-tp-steel">
            + Channel
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 grid w-64 max-w-[calc(100vw-3rem)] gap-2 rounded-xl border border-tp-hairline bg-tp-canvas p-3 shadow-elevation-2">
          <span className="text-xs font-medium text-tp-slate">Channel</span>
          <div className="flex flex-wrap gap-1">
            {used.map(channel => (
              <Chip
                key={channel}
                on={value === channel}
                onClick={() => {
                  onChange(channel);
                  close();
                }}
              >
                {CHANNEL_NAMES[channel] ?? channel}
              </Chip>
            ))}
            <Chip on={!value} onClick={() => onChange(null)}>
              None
            </Chip>
          </div>
          <LabelInput
            value={value}
            known={KNOWN_CHANNELS}
            names={CHANNEL_NAMES}
            placeholder="Or write a new channel"
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

/** Mechanisms typed as one line, split by commas; what is typed stays as typed until it changes elsewhere. */
function MechanismsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (mechanisms: string[]) => void;
}) {
  const split = (text: string) =>
    text
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
  const [text, setText] = useState(value.join(', '));

  useEffect(() => {
    setText(current =>
      split(current).join('\n') === value.join('\n') ? current : value.join(', ')
    );
  }, [value]);

  return (
    <input
      value={text}
      placeholder="How it is reached, separated by commas (e.g. GitHub CLI, REST over HTTPS)"
      aria-label="Mechanisms"
      onChange={e => {
        setText(e.target.value);
        onChange(split(e.target.value));
      }}
      className={`${inputClass} py-1.5 font-mono text-xs`}
    />
  );
}

interface Props {
  node: ServiceNode;
  nodes: ServiceNode[];
  /** `field` names what was typed into, so typing on in it is one undo step. */
  onChange: (interfaces: ServiceInterface[], field: string) => void;
}

/** The interfaces of a service in the outline: add, classify, describe, reorder and remove them. */
export default function InterfaceEditor({ node, nodes, onChange }: Props) {
  const list = node.interfaces;
  // The known channels, then those the tree already uses.
  const used = useMemo(
    () => [
      ...new Set([
        ...KNOWN_CHANNELS,
        ...nodes
          .flatMap(n => n.interfaces.map(item => item.channel))
          .filter((channel): channel is string => !!channel),
      ]),
    ],
    [nodes]
  );
  const [focusLast, setFocusLast] = useState(false);
  const lastNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusLast) return;
    lastNameRef.current?.focus();
    setFocusLast(false);
  }, [focusLast, list.length]);

  const change = (index: number, changes: Partial<ServiceInterface>, field: string) =>
    onChange(
      list.map((item, at) => (at === index ? { ...item, ...changes } : item)),
      field === 'name' || field === 'description' || field === 'mechanisms'
        ? `interface:${index}:${field}`
        : 'interfaces'
    );

  const move = (index: number, direction: -1 | 1) => {
    const next = [...list];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next, 'interfaces');
  };

  return (
    <div className="grid gap-2">
      {list.length === 0 && (
        <p className="text-xs text-tp-steel">
          No interfaces yet: the web app, the API, a CLI, a chat bot... each way the service is
          used.
        </p>
      )}
      {list.map((item, index) => {
        const extras = interfaceExtras(item);
        return (
          <div
            key={index}
            className="grid gap-1.5 rounded-xl border border-tp-hairline bg-tp-canvas p-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
              <ChannelPicker
                value={item.channel}
                used={used}
                onChange={channel => change(index, { channel }, 'channel')}
              />
              <input
                ref={index === list.length - 1 ? lastNameRef : undefined}
                value={item.name}
                maxLength={200}
                placeholder="Name of the interface, e.g. GitHub CLI"
                aria-label="Interface name"
                aria-invalid={!item.name.trim()}
                onChange={e => change(index, { name: e.target.value }, 'name')}
                className={`${inputClass} min-w-[8rem] flex-1 py-1.5 ${item.name.trim() ? '' : 'border-tp-severity-error/60'}`}
              />
              <button
                type="button"
                onClick={() => change(index, { pending: !item.pending }, 'pending')}
                aria-pressed={item.pending}
                title="Found but not confirmed yet"
                className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  item.pending
                    ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'border-tp-hairline text-tp-steel hover:text-tp-ink'
                }`}
              >
                Pending
              </button>
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
                    'interfaces'
                  )
                }
                aria-label={`Remove ${item.name || 'the interface'}`}
                className={`${iconButton} hover:!bg-tp-severity-error-bg hover:!text-tp-severity-error`}
              >
                <Iconify icon="mdi:trash-can-outline" width={15} />
              </button>
            </div>
            <input
              value={item.description}
              maxLength={2000}
              placeholder="What it is (optional)"
              aria-label="Interface description"
              onChange={e => change(index, { description: e.target.value }, 'description')}
              className={`${inputClass} py-1.5 text-xs`}
            />
            <MechanismsInput
              value={item.mechanisms}
              onChange={mechanisms => change(index, { mechanisms }, 'mechanisms')}
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
          onChange([...list, emptyInterface(list[list.length - 1]?.channel ?? null)], 'interfaces');
          setFocusLast(true);
        }}
        className="flex cursor-pointer items-center gap-1.5 justify-self-start rounded-lg px-2 py-1.5 text-xs font-medium text-tp-steel transition-colors hover:bg-tp-canvas hover:text-tp-ink"
      >
        <Iconify icon="mdi:plus" width={15} />
        Add an interface
      </button>
    </div>
  );
}
