import type { ServiceLink } from '../../../../api/serviceTreeApi';

// The links of a service: pages that answer questions about its terms (refunds,
// cancellation, data retention, SLA...). Like interfaces, a link has a few named
// fields and keeps any other one as given, so the taxonomy can grow without code.

/** The fields every link has; anything else is a free field, kept and shown as it comes. */
export const LINK_FIELDS = ['url', 'title', 'topic', 'description'];

/** An absolute http(s) address: the only kind the API takes, and the only kind shown as a link. */
export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

/** The site a link points to, without "www.", to name an untitled link. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** What a link is called: its title, or the site it points to. */
export const linkLabel = (link: ServiceLink) => link.title.trim() || hostOf(link.url);

/** A link in the one shape the API returns (named fields first, then the free ones). */
export function normalizeLink(raw: Record<string, unknown>): ServiceLink {
  const extra = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !LINK_FIELDS.includes(key))
  );
  return {
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    topic: typeof raw.topic === 'string' && raw.topic.trim() ? raw.topic.trim() : null,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    ...extra,
  };
}

export const emptyLink = (topic: string | null = null): ServiceLink => ({
  url: '',
  title: '',
  topic,
  description: '',
});

/** The free fields of a link, in their order. */
export const linkExtras = (link: ServiceLink) =>
  Object.entries(link).filter(([key]) => !LINK_FIELDS.includes(key));

export interface TopicGroup {
  topic: string | null;
  /** Each link with its place in the service's list. */
  items: { link: ServiceLink; index: number }[];
}

/** The links by topic, in the order topics first appear; those without a topic last. */
export function groupByTopic(links: ServiceLink[]): TopicGroup[] {
  const groups = new Map<string | null, TopicGroup>();
  links.forEach((link, index) => {
    const group = groups.get(link.topic) ?? { topic: link.topic, items: [] };
    group.items.push({ link, index });
    groups.set(link.topic, group);
  });
  return [...groups.values()].sort((a, b) => Number(a.topic === null) - Number(b.topic === null));
}
