export interface RecentItem {
  id: string;
  name: string;
  orgId: string;
  orgName: string;
  visitedAt: string;
}

const STORAGE_KEYS = {
  pricings: 'sphere:recentPricings',
  collections: 'sphere:recentCollections',
  organizations: 'sphere:recentOrganizations',
} as const;

const MAX_ITEMS = 20;

function readList(key: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: RecentItem[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function addRecent(key: string, item: Omit<RecentItem, 'visitedAt'>): void {
  const list = readList(key).filter(i => i.id !== item.id);
  list.unshift({ ...item, visitedAt: new Date().toISOString() });
  writeList(key, list.slice(0, MAX_ITEMS));
}

export function addRecentPricing(item: Omit<RecentItem, 'visitedAt'>): void {
  addRecent(STORAGE_KEYS.pricings, item);
}

export function addRecentCollection(item: Omit<RecentItem, 'visitedAt'>): void {
  addRecent(STORAGE_KEYS.collections, item);
}

export function getRecentPricings(): RecentItem[] {
  return readList(STORAGE_KEYS.pricings);
}

export function getRecentCollections(): RecentItem[] {
  return readList(STORAGE_KEYS.collections);
}

export function addRecentOrganization(item: Omit<RecentItem, 'visitedAt'>): void {
  addRecent(STORAGE_KEYS.organizations, item);
}

export function getRecentOrganizations(): RecentItem[] {
  return readList(STORAGE_KEYS.organizations);
}
