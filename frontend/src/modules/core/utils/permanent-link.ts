/**
 * The permanent link of a pricing (`p`, by its pricingId) or a collection (`c`):
 * it survives renames and collection moves, and a pricing's opens the latest
 * version the visitor may see. It is how an unlisted pricing is shared.
 */
export function permanentLinkUrl(kind: 'p' | 'c', id: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/${kind}/${id}`;
}
