import type { ServiceNode } from '../../../../api/serviceTreeApi';
import { KNOWN_CHANNELS, interfaceExtras, normalizeInterface } from './interfaces';
import { childrenOf, newServiceId } from './tree';

// The JSON view writes the tree nested, as it is read: each service holds the
// services inside it. Any key that is not one of a service's fields is kept as
// a free attribute, so a new kind of data (customers, regions...) can be added
// by just writing it, with no change to the API or to this file. "kind" and
// "dependency" are free text too: autonomous, dependent, functional and account
// are the ones the UI knows, and any other value is a new one, kept as written.
//
// {
//   "services": [
//     {
//       "id": "github",
//       "name": "GitHub",
//       "kind": "autonomous",
//       "description": "Code hosting",
//       "pricings": ["github"],
//       "interfaces": [{ "name": "REST API", "channel": "programmatic", "mechanisms": ["HTTPS"] }],
//       "customers": ["Acme"],
//       "services": [{ "name": "Actions", "kind": "dependent", "dependency": "functional" }]
//     }
//   ]
// }

/** The fields of a service in the JSON view. */
const SERVICE_KEYS = [
  'id',
  'name',
  'description',
  'kind',
  'dependency',
  'pricings',
  'interfaces',
  'services',
];

/** Names an attribute cannot take; the API refuses the same ones (RESERVED_ATTRIBUTES in ServiceTreeService). */
const RESERVED_KEYS = new Set([...SERVICE_KEYS, 'parentId', 'pricingIds', 'attributes']);

const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LABEL_LENGTH = 40;
export const KNOWN_KINDS = ['AUTONOMOUS', 'DEPENDENT'];
export const KNOWN_DEPENDENCIES = ['FUNCTIONAL', 'ACCOUNT'];

/** A known kind or dependency in lowercase; one the organization made up, as written. */
const labelToJson = (label: string, known: string[]) =>
  known.includes(label) ? label.toLowerCase() : label;

/** A kind or dependency read from text: known ones in capitals, new ones as written, empty as none. */
export function readLabel(text: string, known: string[]): string | null {
  const label = text.trim();
  if (!label) return null;
  return known.find(value => value === label.toUpperCase()) ?? label;
}
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_ERRORS = 8;

/** Turns a pricing reference written in the JSON (its slug or its pricingId) into its pricingId. */
export type PricingResolver = (reference: string) => { pricingId: string } | { error: string };

export function treeToJson(
  nodes: ServiceNode[],
  pricingLabel: (pricingId: string) => string
): string {
  const write = (node: ServiceNode): Record<string, unknown> => {
    const out: Record<string, unknown> = { id: node.id, name: node.name };
    if (node.kind) out.kind = labelToJson(node.kind, KNOWN_KINDS);
    if (node.dependency) out.dependency = labelToJson(node.dependency, KNOWN_DEPENDENCIES);
    if (node.description) out.description = node.description;
    if (node.pricingIds.length) out.pricings = node.pricingIds.map(pricingLabel);
    if (node.interfaces.length) out.interfaces = node.interfaces.map(writeInterface);
    Object.assign(out, node.attributes);
    const children = childrenOf(nodes, node.id);
    if (children.length) out.services = children.map(write);
    return out;
  };
  return JSON.stringify({ services: childrenOf(nodes, null).map(write) }, null, 2);
}

/** An interface as written by hand: empty fields left out, known channels in lowercase. */
function writeInterface(item: ServiceNode['interfaces'][number]): Record<string, unknown> {
  const out: Record<string, unknown> = { name: item.name };
  if (item.channel) out.channel = labelToJson(item.channel, KNOWN_CHANNELS);
  if (item.pending) out.pending = true;
  if (item.description) out.description = item.description;
  if (item.mechanisms.length) out.mechanisms = item.mechanisms;
  return Object.assign(out, Object.fromEntries(interfaceExtras(item)));
}

/** Where a JSON.parse error happened, as "line L, column C", when the browser says so. */
function syntaxError(text: string, error: Error): string {
  const position = /position (\d+)/.exec(error.message);
  if (!position) return `The JSON is not valid: ${error.message}`;
  const before = text.slice(0, Number(position[1])).split('\n');
  return `The JSON is not valid at line ${before.length}, column ${before[before.length - 1].length + 1}: ${error.message.replace(/\s*\(line.*$|\s*at position \d+.*$/, '')}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reads the JSON view back into the tree, or says everything that is wrong with it. */
export function parseTreeJson(
  text: string,
  resolvePricing: PricingResolver
): { nodes: ServiceNode[] } | { errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { errors: [syntaxError(text, error as Error)] };
  }
  const roots = Array.isArray(data) ? data : isObject(data) ? data.services : undefined;
  if (!Array.isArray(roots))
    return { errors: ['Write the services as a list in "services": { "services": [ ... ] }'] };

  const nodes: ServiceNode[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  const fail = (message: string) => errors.length < MAX_ERRORS && errors.push(message);

  const read = (raw: unknown, parentId: string | null, path: string) => {
    if (!isObject(raw)) return fail(`${path} must be an object with at least a "name"`);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const where = name ? `"${name}"` : path;
    if (!name) fail(`${path} needs a "name"`);

    let id = raw.id;
    if (id === undefined) id = newServiceId();
    if (typeof id !== 'string' || !NODE_ID.test(id)) {
      fail(`The id of ${where} must be letters, digits, - or _ (or leave it out to get one)`);
      id = newServiceId();
    } else if (ids.has(id)) fail(`Two services have the id "${id}"`);
    ids.add(id as string);

    const label = (key: 'kind' | 'dependency', known: string[]) => {
      const value = raw[key];
      if (value === undefined || value === null) return null;
      if (typeof value !== 'string' || value.trim().length > LABEL_LENGTH) {
        fail(`The "${key}" of ${where} must be text of at most ${LABEL_LENGTH} characters`);
        return null;
      }
      return readLabel(value, known);
    };
    const kind = label('kind', KNOWN_KINDS);
    const dependency = label('dependency', KNOWN_DEPENDENCIES);

    if (raw.description !== undefined && typeof raw.description !== 'string')
      fail(`The "description" of ${where} must be text`);
    const description = typeof raw.description === 'string' ? raw.description.trim() : '';

    const pricingIds: string[] = [];
    if (raw.pricings !== undefined) {
      if (!Array.isArray(raw.pricings))
        fail(`The "pricings" of ${where} must be a list of pricing slugs`);
      else
        for (const reference of raw.pricings) {
          if (typeof reference !== 'string') {
            fail(`The "pricings" of ${where} must be a list of pricing slugs`);
            continue;
          }
          const resolved = resolvePricing(reference.trim());
          if ('error' in resolved) fail(`${where}: ${resolved.error}`);
          else if (!pricingIds.includes(resolved.pricingId)) pricingIds.push(resolved.pricingId);
        }
    }

    const interfaces: ServiceNode['interfaces'] = [];
    if (raw.interfaces !== undefined) {
      if (!Array.isArray(raw.interfaces)) fail(`The "interfaces" of ${where} must be a list`);
      else
        raw.interfaces.forEach((item, index) => {
          const at = `interface #${index + 1} of ${where}`;
          if (!isObject(item)) return fail(`${at} must be an object with at least a "name"`);
          if (typeof item.name !== 'string' || !item.name.trim()) fail(`${at} needs a "name"`);
          if (
            item.channel !== undefined &&
            item.channel !== null &&
            (typeof item.channel !== 'string' || item.channel.trim().length > LABEL_LENGTH)
          ) {
            fail(`The "channel" of ${at} must be text of at most ${LABEL_LENGTH} characters`);
          }
          if (item.pending !== undefined && typeof item.pending !== 'boolean')
            fail(`"pending" in ${at} must be true or false`);
          if (
            item.mechanisms !== undefined &&
            (!Array.isArray(item.mechanisms) || item.mechanisms.some(m => typeof m !== 'string'))
          ) {
            fail(`The "mechanisms" of ${at} must be a list of texts`);
          }
          const channel =
            typeof item.channel === 'string' ? readLabel(item.channel, KNOWN_CHANNELS) : null;
          interfaces.push(normalizeInterface({ ...item, channel }));
        });
    }

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (SERVICE_KEYS.includes(key)) continue;
      if (RESERVED_KEYS.has(key))
        fail(
          `"${key}" is not used in the JSON view: nest services in "services" and list pricings in "pricings"`
        );
      else if (!ATTRIBUTE_NAME.test(key))
        fail(
          `"${key}" in ${where} cannot be a field name: start with a letter, then letters, digits, - or _`
        );
      else attributes[key] = value;
    }

    nodes.push({
      id: id as string,
      parentId,
      name,
      description,
      kind,
      dependency,
      pricingIds,
      attributes,
      interfaces,
    });

    if (raw.services !== undefined) {
      if (!Array.isArray(raw.services)) fail(`The "services" of ${where} must be a list`);
      else
        raw.services.forEach((child, index) =>
          read(child, id as string, `${path}.services[${index}]`)
        );
    }
  };

  roots.forEach((raw, index) => read(raw, null, `services[${index}]`));
  return errors.length ? { errors } : { nodes };
}
