/** An anonymous link as its pricing's editors see it (`GET /pricing-anonymous-links`). */
export interface AnonymousLink {
  id: string;
  token: string;
  versionId: string;
  /** The label of the version it shows. */
  version: string;
  createdAt: string;
  /** False while the version is private: the link shows nothing until it is not. */
  active: boolean;
}

export interface AnonymousLinkList {
  links: AnonymousLink[];
  limit: number;
}

/** What a link shows to anyone (`GET /anonymous-pricings/{token}`): these are its only keys. */
export interface AnonymousPricing {
  version: string;
  createdAt: string;
  analytics: Record<string, number>;
  yaml: string;
}
