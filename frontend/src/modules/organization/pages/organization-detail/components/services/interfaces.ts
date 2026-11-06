import type { ServiceInterface } from '../../../../api/serviceTreeApi';
import { BADGE_TONES } from './badgeTones';

// The interfaces of a service: the ways it is used (its web app, its REST API,
// a chat bot...). The taxonomy is still growing, so everything about channels
// lives here: a new channel is one entry in CHANNELS, and a channel that is not
// listed still works, shown with its own name and a neutral tag.

export interface ChannelStyle {
  label: string;
  /** The short tag of the tree, like Helena's. */
  tag: string;
  className: string;
}

export const CHANNELS: Record<string, ChannelStyle> = {
  INTERACTIVE: {
    label: 'Interactive',
    tag: 'Int',
    className: BADGE_TONES.emerald,
  },
  PROGRAMMATIC: {
    label: 'Programmatic',
    tag: 'Prog',
    className: BADGE_TONES.sky,
  },
  CONVERSATIONAL: {
    label: 'Conversational',
    tag: 'Conv',
    className: BADGE_TONES.violet,
  },
  AGENTIC: {
    label: 'Agentic',
    tag: 'Agent',
    className: BADGE_TONES.amber,
  },
  EVENT: {
    label: 'Event',
    tag: 'Event',
    className: BADGE_TONES.rose,
  },
};

export const KNOWN_CHANNELS = Object.keys(CHANNELS);

/** Display names of the known channels, for the pickers. */
export const CHANNEL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CHANNELS).map(([key, style]) => [key, style.label])
);

const NEUTRAL = BADGE_TONES.neutral;

/** How a channel looks: its own style when known, its name in a neutral tag otherwise. */
export function channelStyle(channel: string | null): ChannelStyle {
  if (!channel) return { label: 'Unclassified', tag: '?', className: NEUTRAL };
  return (
    CHANNELS[channel] ?? {
      label: channel,
      tag: channel.length > 6 ? `${channel.slice(0, 5)}…` : channel,
      className: NEUTRAL,
    }
  );
}

/** The fields every interface has; anything else is a free field, kept and shown as it comes. */
export const INTERFACE_FIELDS = ['name', 'channel', 'pending', 'description', 'mechanisms'];

/**
 * An interface in the one shape the API returns (named fields first, then the
 * free ones in their order), so an unchanged interface always compares equal.
 */
export function normalizeInterface(raw: Record<string, unknown>): ServiceInterface {
  const extra = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !INTERFACE_FIELDS.includes(key))
  );
  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    channel: typeof raw.channel === 'string' && raw.channel.trim() ? raw.channel.trim() : null,
    pending: raw.pending === true,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    mechanisms: Array.isArray(raw.mechanisms)
      ? raw.mechanisms
          .filter((m): m is string => typeof m === 'string' && !!m.trim())
          .map(m => m.trim())
      : [],
    ...extra,
  };
}

export const emptyInterface = (channel: string | null = null): ServiceInterface => ({
  name: '',
  channel,
  pending: false,
  description: '',
  mechanisms: [],
});

/** The free fields of an interface (a quote, its source...), in their order. */
export const interfaceExtras = (item: ServiceInterface) =>
  Object.entries(item).filter(([key]) => !INTERFACE_FIELDS.includes(key));

export interface ChannelGroup {
  channel: string | null;
  style: ChannelStyle;
  /** Each interface with its place in the service's list, to pick it. */
  items: { item: ServiceInterface; index: number }[];
}

/** The interfaces by channel: the known ones in their order, then new ones, then the unclassified. */
export function groupByChannel(interfaces: ServiceInterface[]): ChannelGroup[] {
  const groups = new Map<string | null, ChannelGroup>();
  interfaces.forEach((item, index) => {
    const group = groups.get(item.channel) ?? {
      channel: item.channel,
      style: channelStyle(item.channel),
      items: [],
    };
    group.items.push({ item, index });
    groups.set(item.channel, group);
  });
  const rank = (channel: string | null) =>
    channel === null
      ? KNOWN_CHANNELS.length + 1
      : KNOWN_CHANNELS.includes(channel)
        ? KNOWN_CHANNELS.indexOf(channel)
        : KNOWN_CHANNELS.length;
  return [...groups.values()].sort((a, b) => rank(a.channel) - rank(b.channel));
}

/** "16 +8 pending": confirmed interfaces, and those still pending. */
export function interfaceCounts(interfaces: ServiceInterface[]) {
  const pending = interfaces.filter(item => item.pending).length;
  return { confirmed: interfaces.length - pending, pending };
}
