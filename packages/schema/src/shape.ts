/**
 * The additive-only rule, made falsifiable.
 *
 * `schema_version` evolution is supposed to be additive: new fields, never a reordering, a
 * retyping, or a repurposing. That has been a convention, and this project's own history is that
 * conventions about the contract held only once a test enforced them — the 49-keypoint order
 * survived because `test_invariants.py` asserts it, not because everyone remembered.
 *
 * So: every schema is reduced to a SIGNATURE — one entry per node, keyed by its JSON pointer,
 * carrying only the things a consumer can break on. The signature is committed as
 * `schemas/shape-lock.json`, and `shape-lock.test.ts` fails when the current schemas break it.
 *
 * Pointers are recorded as written, WITHOUT resolving `$ref`. Renaming a definition therefore
 * reads as a removal, which is correct: the generated TypeScript interface is named after it, so
 * a rename is a break for anyone importing the type.
 *
 * What counts as breaking, and nothing else does:
 *
 *   1. a node disappears            — an old client reads a field that is gone
 *   2. its `type` changes           — repurposing; the worst kind, because it validates
 *   3. its `$ref` target changes    — same thing one level up
 *   4. `required` gains an entry    — every stored artifact written before it is now invalid
 *   5. an `enum` loses a member     — a stored value stops being legal
 *
 * Adding a node, adding an enum member, and RELAXING `required` are all additive, and pass.
 */

export interface ShapeEntry {
  /** Normalized JSON Schema type — arrays sorted, so `["null","string"]` and `["string","null"]` match. */
  type?: string;
  ref?: string;
  required?: string[];
  enum?: string[];
}

export type Signature = Record<string, ShapeEntry>;

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The keywords whose values are themselves schemas, keyed by how they nest. */
const SUBSCHEMA_MAPS = ["properties", "definitions", "patternProperties"] as const;
const SUBSCHEMA_LISTS = ["anyOf", "oneOf", "allOf"] as const;
const SUBSCHEMA_SINGLES = ["additionalProperties", "additionalItems", "not"] as const;

/** A node is worth locking when it says something a consumer could depend on. */
function entryFor(node: Node): ShapeEntry | null {
  const entry: ShapeEntry = {};
  const t = node.type;
  if (typeof t === "string") entry.type = t;
  else if (Array.isArray(t)) entry.type = [...t].map(String).sort().join("|");
  if (typeof node.$ref === "string") entry.ref = node.$ref;
  if (Array.isArray(node.required)) entry.required = [...node.required].map(String).sort();
  if (Array.isArray(node.enum)) entry.enum = node.enum.map((v) => JSON.stringify(v)).sort();
  return Object.keys(entry).length ? entry : null;
}

const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

function walk(node: unknown, path: string, out: Signature): void {
  if (!isNode(node)) return;

  const entry = entryFor(node);
  if (entry) out[path] = entry;

  for (const keyword of SUBSCHEMA_MAPS) {
    const map = node[keyword];
    if (!isNode(map)) continue;
    for (const [key, child] of Object.entries(map)) {
      walk(child, `${path}/${keyword}/${escape(key)}`, out);
    }
  }
  for (const keyword of SUBSCHEMA_LISTS) {
    const list = node[keyword];
    if (!Array.isArray(list)) continue;
    list.forEach((child, i) => walk(child, `${path}/${keyword}/${i}`, out));
  }
  for (const keyword of SUBSCHEMA_SINGLES) {
    if (keyword in node) walk(node[keyword], `${path}/${keyword}`, out);
  }
  // `items` is either one schema or a positional tuple; both nest.
  const items = node.items;
  if (Array.isArray(items)) items.forEach((child, i) => walk(child, `${path}/items/${i}`, out));
  else if (isNode(items)) walk(items, `${path}/items`, out);
}

/** One schema document reduced to its locked shape. `name` prefixes every pointer. */
export function schemaSignature(name: string, schema: unknown): Signature {
  const out: Signature = {};
  walk(schema, `${name}#`, out);
  return out;
}

/** Human-readable breaking changes, empty when the new signature is a superset in the ways that matter. */
export function breakingChanges(locked: Signature, current: Signature): string[] {
  const problems: string[] = [];

  for (const [path, was] of Object.entries(locked)) {
    const now = current[path];
    if (!now) {
      problems.push(`${path} was REMOVED — old clients and stored artifacts still reference it`);
      continue;
    }
    if (was.type !== now.type) {
      problems.push(`${path} changed type: ${was.type ?? "(none)"} -> ${now.type ?? "(none)"}`);
    }
    if (was.ref !== now.ref) {
      problems.push(`${path} changed $ref: ${was.ref ?? "(none)"} -> ${now.ref ?? "(none)"}`);
    }
    const added = (now.required ?? []).filter((k) => !(was.required ?? []).includes(k));
    if (added.length) {
      problems.push(
        `${path} newly REQUIRES ${added.join(", ")} — every artifact written before this is now invalid`,
      );
    }
    const dropped = (was.enum ?? []).filter((v) => !(now.enum ?? []).includes(v));
    if (dropped.length) {
      problems.push(`${path} dropped enum value(s) ${dropped.join(", ")} — stored values become illegal`);
    }
  }

  return problems;
}
