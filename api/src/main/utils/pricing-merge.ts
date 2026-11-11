import yaml from 'js-yaml';
import { PRICING_YAML_MAX_DEPTH, PricingDoc, PricingYamlError } from './pricing-syntax';

/**
 * Three-way merge of pricing documents: the base a proposal started from, the
 * current version and the proposal. Pure: it reads and writes no files.
 *
 * It works on the documents `js-yaml` loads (after `loadPricingDoc` and the
 * upgrade to the latest syntax), never on the parsed `Pricing`, whose defaults
 * would show as changes. `version`, `createdAt` and `saasName` are not compared:
 * whoever publishes the result stamps them. `plans`, `features`, `addOns` and
 * `usageLimits` are merged entry by entry, and the order of their entries is
 * compared as one more attribute of the section, because the UI draws rows and
 * columns in that order. Every other top-level key belongs to `general`.
 */

export const IGNORED_TOP_LEVEL_KEYS: readonly string[] = ['version', 'createdAt', 'saasName'];
export const PRICING_SECTIONS = ['plans', 'features', 'addOns', 'usageLimits'] as const;
export type PricingSection = (typeof PRICING_SECTIONS)[number];
export type MergeSection = PricingSection | 'general';

/**
 * Nodes one merge may visit across all its comparisons, ten times what a single
 * document may hold when it is loaded (`PRICING_YAML_MAX_VISITS`).
 */
export const PRICING_MERGE_MAX_VISITS = 2_000_000;

/** Lists of names merged as sets, and the section the names refer to. */
const REFERENCE_TARGETS = new Map<string, PricingSection>([
  ['linkedFeatures', 'features'],
  ['availableFor', 'plans'],
  ['dependsOn', 'addOns'],
  ['excludes', 'addOns'],
]);
/** Fields of the current version that change what every price means. */
const GLOBAL_FIELDS = ['currency', 'billing', 'variables'];
const PRICED_SECTIONS: readonly PricingSection[] = ['plans', 'addOns'];

const IGNORED = new Set(IGNORED_TOP_LEVEL_KEYS);
const SECTIONS = new Set<string>(PRICING_SECTIONS);

export type ConflictValue = { present: false } | { present: true; value: unknown };
/** A side of a conflict as clients see it: absent, or its value written as YAML. */
export type ConflictSide = { present: false } | { present: true; yaml: string };
export type ConflictScope = 'value' | 'entry' | 'list' | 'order';
export type ConflictChoice = 'current' | 'proposal';

export interface MergeConflict {
  /** `JSON.stringify(path)`. */
  id: string;
  path: string[];
  label: string;
  section: MergeSection;
  entry?: string;
  scope: ConflictScope;
  base: ConflictSide;
  current: ConflictSide;
  proposal: ConflictSide;
}

export type MergeOutcome = 'no-changes' | 'proposal-only' | 'merged' | 'conflicts';

export type MergeWarning =
  | { code: 'FORMAT_REGENERATED' }
  | { code: 'MANUAL_OVERRIDE' }
  | { code: 'GLOBAL_FIELD_CHANGED'; fields: string[] };

export interface MergeOutput {
  outcome: MergeOutcome;
  /** The merge, with the current side wherever a conflict is still open. */
  doc: PricingDoc;
  conflicts: MergeConflict[];
  warnings: MergeWarning[];
}

export interface ResolvedMerge {
  outcome: MergeOutcome;
  doc: PricingDoc;
  /** Ids of the conflicts no resolution chose a side for. */
  unresolved: string[];
  warnings: MergeWarning[];
}

export type PricingMergeErrorCode = 'UNKNOWN_RESOLUTION' | 'UNRESOLVED_CONFLICTS';

export class PricingMergeError extends Error {
  constructor(
    readonly status: number,
    readonly code: PricingMergeErrorCode,
    message: string,
    readonly conflictIds: string[]
  ) {
    super(message);
    this.name = 'PricingMergeError';
  }
}

const ABSENT: ConflictValue = { present: false };

interface RawConflict {
  path: string[];
  scope: ConflictScope;
  base: ConflictValue;
  current: ConflictValue;
  proposal: ConflictValue;
}

/** What `applyResolutions` needs from a merge and clients never see. */
interface MergeInternals {
  current: PricingDoc;
  proposal: PricingDoc;
  conflicts: Map<string, RawConflict>;
  globalWarnings: MergeWarning[];
}

const INTERNALS = new WeakMap<MergeOutput, MergeInternals>();

function isMap(value: unknown): value is PricingDoc {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function hasOwn(container: PricingDoc, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(container, key);
}

function slotOf(container: unknown, key: string): ConflictValue {
  return isMap(container) && hasOwn(container, key) ? { present: true, value: container[key] } : ABSENT;
}

function slotAt(root: unknown, path: readonly string[]): ConflictValue {
  let slot: ConflictValue = { present: true, value: root };
  for (const key of path) {
    if (!slot.present) return ABSENT;
    slot = slotOf(slot.value, key);
  }
  return slot;
}

/** Defines the key as an own property, so `__proto__` stays data and never a prototype. */
function setOwn(container: PricingDoc, key: string, value: unknown): void {
  Object.defineProperty(container, key, { value, enumerable: true, writable: true, configurable: true });
}

function fromEntries(entries: Iterable<[string, unknown]>): PricingDoc {
  const result: PricingDoc = {};
  for (const [key, value] of entries) setOwn(result, key, value);
  return result;
}

function tooComplex(): PricingYamlError {
  return new PricingYamlError(
    422,
    'PRICING_TOO_COMPLEX',
    `The pricings are too complex to compare: a merge may visit at most ${PRICING_MERGE_MAX_VISITS} values nested at most ${PRICING_YAML_MAX_DEPTH} levels deep`
  );
}

class Budget {
  private visits = 0;

  visit(depth: number): void {
    this.visits += 1;
    if (this.visits > PRICING_MERGE_MAX_VISITS || depth > PRICING_YAML_MAX_DEPTH) throw tooComplex();
  }
}

function equal(a: unknown, b: unknown, depth: number, budget: Budget): boolean {
  budget.visit(depth);
  if (Object.is(a, b)) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => equal(item, b[index], depth + 1, budget));
  }
  if (!isMap(a) || !isMap(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => hasOwn(b, key) && equal(a[key], b[key], depth + 1, budget));
}

/**
 * Deep equality of YAML values: mappings regardless of key order, lists in
 * order, scalars with `Object.is` (so `.nan` equals `.nan`) and dates by time.
 */
export function semanticallyEqual(a: unknown, b: unknown): boolean {
  return equal(a, b, 0, new Budget());
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function onlyKeysIn(keys: readonly string[], ...others: ReadonlyArray<readonly string[]>): string[] {
  const sets = others.map((other) => new Set(other));
  return keys.filter((key) => sets.every((set) => set.has(key)));
}

/** Whether `moved` lists the keys it shares with `base` in another relative order. */
function reordered(base: readonly string[], moved: readonly string[]): boolean {
  return !sameSequence(onlyKeysIn(base, moved), onlyKeysIn(moved, base));
}

const HEAD = Symbol('head');

/**
 * The order of `present` keys: the winner's order, with each key it lacks placed
 * right after the key that precedes it in `other` (or first, if none does).
 */
function arrange(winner: readonly string[], present: ReadonlySet<string>, other: readonly string[]): string[] {
  const placed = new Set(winner.filter((key) => present.has(key)));
  const after = new Map<string | typeof HEAD, string[]>();
  let previous: string | typeof HEAD = HEAD;
  for (const key of other) {
    if (!present.has(key)) continue;
    if (!placed.has(key)) {
      const bucket = after.get(previous) ?? [];
      bucket.push(key);
      after.set(previous, bucket);
      placed.add(key);
    }
    previous = key;
  }
  const order: string[] = [];
  // Depth-first and without recursion: a key, then the keys placed after it.
  const emit = (start: string | typeof HEAD): void => {
    const pending = [start];
    while (pending.length > 0) {
      const key = pending.pop() as string | typeof HEAD;
      if (key !== HEAD) order.push(key);
      const next = after.get(key);
      if (next) for (let i = next.length - 1; i >= 0; i--) pending.push(next[i]);
    }
  };
  emit(HEAD);
  for (const key of winner) if (present.has(key)) emit(key);
  return order;
}

function same(a: ConflictValue, b: ConflictValue, depth: number, budget: Budget): boolean {
  if (!a.present || !b.present) return a.present === b.present;
  return equal(a.value, b.value, depth, budget);
}

/** Equal content and, for two mappings, the same order of entries. */
function sameSection(a: ConflictValue, b: ConflictValue, budget: Budget): boolean {
  if (!same(a, b, 1, budget)) return false;
  if (a.present && b.present && isMap(a.value) && isMap(b.value)) {
    return sameSequence(Object.keys(a.value), Object.keys(b.value));
  }
  return true;
}

/** The same document for a merge: ignored keys left out, order of section entries included. */
function sameDoc(a: PricingDoc, b: PricingDoc, budget: Budget): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORED.has(key)) continue;
    const left = slotOf(a, key);
    const right = slotOf(b, key);
    if (SECTIONS.has(key) ? !sameSection(left, right, budget) : !same(left, right, 1, budget)) return false;
  }
  return true;
}

function outcomeOf(doc: PricingDoc, current: PricingDoc, proposal: PricingDoc, open: number, budget: Budget): MergeOutcome {
  if (open > 0) return 'conflicts';
  if (sameDoc(doc, current, budget)) return 'no-changes';
  if (sameDoc(doc, proposal, budget)) return 'proposal-only';
  return 'merged';
}

function sectionOf(path: readonly string[]): MergeSection {
  return SECTIONS.has(path[0]) ? (path[0] as PricingSection) : 'general';
}

function isEntryPath(path: readonly string[]): boolean {
  return path.length === 2 && SECTIONS.has(path[0]);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A path as people read it: `plans.PRO.price`, or `plans["PRO.v2"].price`. */
export function formatConflictPath(path: readonly string[]): string {
  return path
    .map((key, index) => {
      if (!IDENTIFIER.test(key)) return `[${JSON.stringify(key)}]`;
      return index === 0 ? key : `.${key}`;
    })
    .join('');
}

/** A conflict side for clients. Values go as YAML, so `.inf`, `.nan` and dates show as written. */
export function serializeConflictValue(side: ConflictValue): ConflictSide {
  return side.present ? { present: true, yaml: yaml.dump(side.value, { lineWidth: -1, noRefs: true }) } : { present: false };
}

class MergeRun {
  readonly conflicts: RawConflict[] = [];

  constructor(
    private readonly budget: Budget,
    private readonly base: PricingDoc,
    private readonly current: PricingDoc,
    private readonly proposal: PricingDoc
  ) {}

  private same(a: ConflictValue, b: ConflictValue, depth: number): boolean {
    return same(a, b, depth, this.budget);
  }

  private sameSection(a: ConflictValue, b: ConflictValue): boolean {
    return sameSection(a, b, this.budget);
  }

  private conflict(path: string[], scope: ConflictScope, base: ConflictValue, current: ConflictValue, proposal: ConflictValue): void {
    this.conflicts.push({ path, scope, base, current, proposal });
  }

  private mergeReferences(depth: number, base: unknown[], current: unknown[], proposal: unknown[]): unknown[] {
    const includes = (list: unknown[], item: unknown) => list.some((other) => equal(other, item, depth + 1, this.budget));
    const result = current.filter((item) => includes(proposal, item) || !includes(base, item));
    for (const item of proposal) {
      if (!includes(base, item) && !includes(result, item)) result.push(item);
    }
    return result;
  }

  private mergeEntries(path: string[], base: PricingDoc, current: PricingDoc, proposal: PricingDoc): Map<string, unknown> {
    const merged = new Map<string, unknown>();
    for (const key of new Set([...Object.keys(current), ...Object.keys(proposal), ...Object.keys(base)])) {
      const slot = this.mergeValue([...path, key], slotOf(base, key), slotOf(current, key), slotOf(proposal, key));
      if (slot.present) merged.set(key, slot.value);
    }
    return merged;
  }

  private ordered(merged: Map<string, unknown>, winner: readonly string[], other: readonly string[]): PricingDoc {
    const present = new Set(merged.keys());
    return fromEntries(arrange(winner, present, other).map((key) => [key, merged.get(key)]));
  }

  mergeValue(path: string[], base: ConflictValue, current: ConflictValue, proposal: ConflictValue): ConflictValue {
    const depth = path.length;
    this.budget.visit(depth);
    if (this.same(current, proposal, depth)) return current;
    if (this.same(base, current, depth)) return proposal;
    if (this.same(base, proposal, depth)) return current;

    const entry = isEntryPath(path);
    if (current.present && proposal.present) {
      const [c, p] = [current.value, proposal.value];
      // Two different entries added under the same name are one conflict, not a mix of both.
      if (isMap(c) && isMap(p) && !(entry && !base.present)) {
        const b = base.present && isMap(base.value) ? base.value : {};
        return { present: true, value: this.ordered(this.mergeEntries(path, b, c, p), Object.keys(c), Object.keys(p)) };
      }
      const key = path[path.length - 1];
      const references = REFERENCE_TARGETS.has(key) && !entry;
      if (references && Array.isArray(c) && Array.isArray(p) && (!base.present || Array.isArray(base.value))) {
        const b = base.present ? (base.value as unknown[]) : [];
        return { present: true, value: this.mergeReferences(depth, b, c, p) };
      }
    }

    const lists = current.present && proposal.present && Array.isArray(current.value) && Array.isArray(proposal.value);
    this.conflict(path, entry ? 'entry' : lists ? 'list' : 'value', base, current, proposal);
    return current;
  }

  mergeSection(name: PricingSection): ConflictValue {
    const path = [name];
    const base = slotOf(this.base, name);
    const current = slotOf(this.current, name);
    const proposal = slotOf(this.proposal, name);
    if (!(current.present && proposal.present && isMap(current.value) && isMap(proposal.value))) {
      return this.mergeValue(path, base, current, proposal);
    }
    this.budget.visit(1);
    if (this.sameSection(current, proposal)) return current;
    if (this.sameSection(base, current)) return proposal;
    if (this.sameSection(base, proposal)) return current;

    const b = base.present && isMap(base.value) ? base.value : {};
    const merged = this.mergeEntries(path, b, current.value, proposal.value);
    const baseKeys = Object.keys(b);
    const currentKeys = Object.keys(current.value);
    const proposalKeys = Object.keys(proposal.value);
    const currentMoved = reordered(baseKeys, currentKeys);
    const proposalMoved = reordered(baseKeys, proposalKeys);
    if (proposalMoved && !currentMoved) return { present: true, value: this.ordered(merged, proposalKeys, currentKeys) };
    if (
      currentMoved &&
      proposalMoved &&
      !sameSequence(onlyKeysIn(currentKeys, baseKeys, proposalKeys), onlyKeysIn(proposalKeys, baseKeys, currentKeys))
    ) {
      this.conflict(
        path,
        'order',
        { present: true, value: baseKeys },
        { present: true, value: currentKeys },
        { present: true, value: proposalKeys }
      );
    }
    return { present: true, value: this.ordered(merged, currentKeys, proposalKeys) };
  }

  mergeDocs(): PricingDoc {
    const merged = new Map<string, unknown>();
    const keys = new Set([...Object.keys(this.current), ...Object.keys(this.proposal), ...Object.keys(this.base)]);
    for (const key of keys) {
      let slot: ConflictValue;
      if (IGNORED.has(key)) slot = slotOf(this.current, key);
      else if (SECTIONS.has(key)) slot = this.mergeSection(key as PricingSection);
      else slot = this.mergeValue([key], slotOf(this.base, key), slotOf(this.current, key), slotOf(this.proposal, key));
      if (slot.present) merged.set(key, slot.value);
    }
    return this.ordered(merged, Object.keys(this.current), Object.keys(this.proposal));
  }

  private covered(path: readonly string[]): boolean {
    return this.conflicts.some(
      (conflict) => conflict.scope !== 'order' && conflict.path.every((key, index) => path[index] === key)
    );
  }

  /**
   * Names the proposal added to a reference list (and the current version did
   * not) that are missing from the section of the result they refer to: the
   * current version removed them. The list becomes a conflict, so a merge never
   * yields such a dangling reference without one.
   */
  checkReferences(result: PricingDoc): void {
    const visit = (node: PricingDoc, path: string[]): void => {
      for (const key of Object.keys(node)) {
        this.budget.visit(path.length + 1);
        const child = node[key];
        const childPath = [...path, key];
        const target = REFERENCE_TARGETS.get(key);
        if (target && Array.isArray(child)) {
          if (this.danglingProposalNames(result, childPath, child, target)) {
            const current = slotAt(this.current, childPath);
            this.conflict(childPath, 'value', slotAt(this.base, childPath), current, slotAt(this.proposal, childPath));
            if (current.present) setOwn(node, key, current.value);
            else delete node[key];
          }
        } else if (isMap(child)) {
          visit(child, childPath);
        }
      }
    };
    visit(result, []);
  }

  private danglingProposalNames(result: PricingDoc, path: string[], list: unknown[], target: PricingSection): boolean {
    if (this.covered(path)) return false;
    const proposal = slotAt(this.proposal, path);
    if (!proposal.present || !Array.isArray(proposal.value)) return false;
    const listed = (root: PricingDoc) => {
      const slot = slotAt(root, path);
      return new Set(slot.present && Array.isArray(slot.value) ? slot.value : []);
    };
    const inBase = listed(this.base);
    const inCurrent = listed(this.current);
    const inResult = new Set(list);
    const section = result[target];
    return proposal.value.some(
      (name) =>
        typeof name === 'string' &&
        !inBase.has(name) &&
        !inCurrent.has(name) &&
        inResult.has(name) &&
        !(isMap(section) && hasOwn(section, name))
    );
  }

  /** `GLOBAL_FIELD_CHANGED` when the current version moved currency, billing or variables and the proposal touches a price. */
  globalWarnings(): MergeWarning[] {
    const fields = GLOBAL_FIELDS.filter(
      (field) => !this.same(slotOf(this.base, field), slotOf(this.current, field), 1)
    );
    if (fields.length === 0) return [];
    const touchesPrice = PRICED_SECTIONS.some((name) => {
      const base = slotOf(this.base, name);
      const proposal = slotOf(this.proposal, name);
      const entries = new Set([
        ...(base.present && isMap(base.value) ? Object.keys(base.value) : []),
        ...(proposal.present && isMap(proposal.value) ? Object.keys(proposal.value) : []),
      ]);
      return [...entries].some(
        (entry) => !this.same(slotAt(this.base, [name, entry, 'price']), slotAt(this.proposal, [name, entry, 'price']), 3)
      );
    });
    return touchesPrice ? [{ code: 'GLOBAL_FIELD_CHANGED', fields }] : [];
  }
}

function conflictId(path: readonly string[]): string {
  return JSON.stringify(path);
}

function toClientConflict(conflict: RawConflict): MergeConflict {
  const section = sectionOf(conflict.path);
  const entry = section !== 'general' && conflict.scope !== 'order' ? conflict.path[1] : undefined;
  return {
    id: conflictId(conflict.path),
    path: conflict.path,
    label: conflict.scope === 'order' ? `Order of ${section}` : formatConflictPath(conflict.path),
    section,
    ...(entry !== undefined ? { entry } : {}),
    scope: conflict.scope,
    base: serializeConflictValue(conflict.base),
    current: serializeConflictValue(conflict.current),
    proposal: serializeConflictValue(conflict.proposal),
  };
}

function withFormatWarning(outcome: MergeOutcome, warnings: MergeWarning[]): MergeWarning[] {
  return outcome === 'merged' || outcome === 'conflicts' ? [{ code: 'FORMAT_REGENERATED' }, ...warnings] : warnings;
}

/**
 * Merges what `proposal` changed from `base` into `current`.
 *
 * - `no-changes`: the proposal changes nothing, or the current version already has it all.
 * - `proposal-only`: the result is the proposal, so its own text can be published.
 * - `merged`: both sides changed and the result has to be written again (`FORMAT_REGENERATED`).
 * - `conflicts`: some changes clash; `doc` keeps the current side of each until `applyResolutions`.
 *
 * Throws 422 `PRICING_TOO_COMPLEX` past `PRICING_MERGE_MAX_VISITS` or the nesting limit.
 */
export function mergePricingDocs(base: PricingDoc, current: PricingDoc, proposal: PricingDoc): MergeOutput {
  const budget = new Budget();
  const run = new MergeRun(budget, base, current, proposal);
  let doc: PricingDoc;
  if (sameDoc(base, proposal, budget)) {
    doc = structuredClone(current);
  } else {
    doc = structuredClone(run.mergeDocs());
    run.checkReferences(doc);
  }
  const globalWarnings = run.globalWarnings();
  const outcome = outcomeOf(doc, current, proposal, run.conflicts.length, budget);
  const output: MergeOutput = {
    outcome,
    doc,
    conflicts: run.conflicts.map(toClientConflict),
    warnings: withFormatWarning(outcome, globalWarnings),
  };
  INTERNALS.set(output, {
    current,
    proposal,
    conflicts: new Map(run.conflicts.map((conflict) => [conflictId(conflict.path), conflict])),
    globalWarnings,
  });
  return output;
}

function choose(doc: PricingDoc, conflict: RawConflict, choice: ConflictChoice): void {
  const side = choice === 'current' ? conflict.current : conflict.proposal;
  const parentPath = conflict.path.slice(0, -1);
  const key = conflict.path[conflict.path.length - 1];
  const parent = slotAt(doc, parentPath);
  if (!parent.present || !isMap(parent.value)) {
    throw new Error(`The merged pricing has no mapping at ${formatConflictPath(parentPath)}`);
  }
  if (conflict.scope === 'order') {
    const section = parent.value[key];
    if (!isMap(section) || !side.present) return;
    const keys = Object.keys(section);
    const order = arrange(side.value as string[], new Set(keys), keys);
    setOwn(parent.value, key, fromEntries(order.map((name) => [name, section[name]])));
    return;
  }
  if (side.present) setOwn(parent.value, key, structuredClone(side.value));
  else delete parent.value[key];
}

/**
 * Applies the side chosen for each conflict (`current` keeps the current
 * version's value, `proposal` takes the proposal's; an absent side removes the
 * key). Choosing a side replaces the whole value at the conflict's path. With
 * `manual`, that document is the result (it takes precedence over any
 * resolution), and resolutions are only checked to be known.
 *
 * Throws 409 `UNRESOLVED_CONFLICTS` when `requireAll` and a conflict has no
 * side, and 422 `UNKNOWN_RESOLUTION` for an id or a choice the merge does not have.
 * The output is not modified.
 */
export function applyResolutions(
  output: MergeOutput,
  resolutions: Record<string, unknown>,
  options: { requireAll: boolean; manual?: PricingDoc }
): ResolvedMerge {
  const internals = INTERNALS.get(output);
  if (!internals) throw new Error('applyResolutions takes the output of mergePricingDocs');

  const chosen = (id: string) => Object.prototype.hasOwnProperty.call(resolutions, id);
  const unresolved = [...internals.conflicts.keys()].filter((id) => !chosen(id));
  if (options.requireAll && !options.manual && unresolved.length > 0) {
    throw new PricingMergeError(409, 'UNRESOLVED_CONFLICTS', 'Choose a side for every conflict', unresolved);
  }
  const unknown = Object.keys(resolutions).filter(
    (id) => !internals.conflicts.has(id) || (resolutions[id] !== 'current' && resolutions[id] !== 'proposal')
  );
  if (unknown.length > 0) {
    throw new PricingMergeError(
      422,
      'UNKNOWN_RESOLUTION',
      'Some resolutions name a conflict this merge does not have or a side other than current or proposal',
      unknown
    );
  }

  const budget = new Budget();
  if (options.manual) {
    const doc = structuredClone(options.manual);
    return {
      outcome: outcomeOf(doc, internals.current, internals.proposal, 0, budget),
      doc,
      unresolved: [],
      warnings: [{ code: 'MANUAL_OVERRIDE' }, ...internals.globalWarnings],
    };
  }

  const doc = structuredClone(output.doc);
  const picks = [...internals.conflicts.entries()].filter(([id]) => chosen(id));
  // Entries first: reordering a section then sees the entries the other choices left.
  for (const [id, conflict] of picks) if (conflict.scope !== 'order') choose(doc, conflict, resolutions[id] as ConflictChoice);
  for (const [id, conflict] of picks) if (conflict.scope === 'order') choose(doc, conflict, resolutions[id] as ConflictChoice);
  const outcome = outcomeOf(doc, internals.current, internals.proposal, unresolved.length, budget);
  return { outcome, doc, unresolved, warnings: withFormatWarning(outcome, internals.globalWarnings) };
}
