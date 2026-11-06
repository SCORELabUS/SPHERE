/** A version in a pricing's version graph. */
export interface PricingGraphVersion {
  id: string;
  version: string;
  /** Null for a version of a source the viewer may not read: only its label is known. */
  createdAt: string | null;
  private: boolean;
  /** The version it was forked from, by pricing and label: an edge of the graph. */
  forkedFrom: { pricingId: string; version: string } | null;
}

/** One pricing of a version graph, drawn as a lane. */
export interface PricingGraphLane {
  pricingId: string;
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string };
  collectionSlug: string | null;
  /** The pricing shown, or the one it was forked from. */
  role: 'current' | 'source';
  /** False for a source the viewer may not read. */
  available: boolean;
  versions: PricingGraphVersion[];
}

export interface PricingGraph {
  pricingId: string;
  lanes: PricingGraphLane[];
  /** More sources exist than were drawn. */
  truncated: boolean;
}
