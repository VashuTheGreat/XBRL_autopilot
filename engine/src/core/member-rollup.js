// Parent-member roll-ups (ADR-0013, Phase 11 step 3b) — read from the taxonomy's domain-member trees, no table- or
// taxonomy-specific code. Used by the Session to derive (origin 'calculated') a table value under a parent member as
// the sum of the values under its child members, exactly like a calculation parent:
//
//   Changes in equity (Ind AS 400200): a figure entered under Other retained earning also files Retained earnings,
//   Reserves and Equity attributable to the equity holders of the parent (Dixon, MCA-accepted, files all four, equal).
//
// A member's parent is taken from the table axes' member trees (authority `tables[].axes[].members[].parent`). Only a
// real, usable member is derived: the axis default (the domain, "total" column) is the statement figure or the
// table's total column, which other derivations (derived.js) or the filer supply. Amounts and share counts only
// (percentages, per-share figures and pure numbers don't add up). A member whose parent differs between tables is
// left out (no guess). Entered or imported parent values are kept unless they agreed before the edit, and a manual
// override is never replaced (Session.applyDerived).
import { dimensionallyValid } from './dimensions.js';
import { normDims } from './model.js';

const CACHE = new WeakMap();
const KINDS = new Set(['monetary', 'shares']);

// axis -> { parentOf: Map(member -> parent), childrenOf: Map(parent -> Set(member)) }
export function memberTrees(A) {
  if (CACHE.has(A)) return CACHE.get(A);
  const parents = new Map(); // axis -> Map(member -> parent | null (ambiguous))
  for (const t of A.tables) {
    for (const ax of t.axes) {
      if (ax.typed) continue;
      const usable = new Set((ax.members || []).filter((m) => m.usable).map((m) => m.member));
      const def = A.dimensionDefault(ax.axis);
      const map = parents.get(ax.axis) || parents.set(ax.axis, new Map()).get(ax.axis);
      for (const m of ax.members || []) {
        if (!m.parent || !m.usable || !usable.has(m.parent) || m.parent === def) continue;
        if (map.has(m.member) && map.get(m.member) !== m.parent) map.set(m.member, null);
        else map.set(m.member, m.parent);
      }
    }
  }
  const out = new Map();
  for (const [axis, map] of parents) {
    const parentOf = new Map([...map].filter(([, p]) => p));
    const childrenOf = new Map();
    for (const [m, p] of parentOf) (childrenOf.get(p) || childrenOf.set(p, new Set()).get(p)).add(m);
    out.set(axis, { parentOf, childrenOf });
  }
  CACHE.set(A, out);
  return out;
}

const rollsUp = (A, concept) => KINDS.has(A.dataType(concept));

// The parent-member cells an edited cell feeds: one per explicit member that has a parent member, where the element
// can be reported with that parent instead (dimensionally valid). [{ axis, parent, dims }]
export function rollupTargetsOf(A, concept, dims) {
  if (!rollsUp(A, concept)) return [];
  const trees = memberTrees(A);
  const out = [];
  for (const d of dims) {
    if (!d.member) continue;
    const parent = trees.get(d.axis)?.parentOf.get(d.member);
    if (!parent) continue;
    const pd = normDims(dims.map((x) => (x.axis === d.axis ? { axis: x.axis, member: parent } : x)));
    if (dimensionallyValid(A, concept, pd).valid) out.push({ axis: d.axis, parent, dims: pd });
  }
  return out;
}

// The child-member cells of a parent-member cell, on one axis: [{ member, dims }] (empty when the member has none).
export function rollupChildrenOf(A, concept, axis, dims) {
  if (!rollsUp(A, concept)) return [];
  const parent = dims.find((x) => x.axis === axis)?.member;
  const kids = parent ? memberTrees(A).get(axis)?.childrenOf.get(parent) : null;
  if (!kids) return [];
  return [...kids].map((member) => ({ member, dims: normDims(dims.map((x) => (x.axis === axis ? { axis, member } : x))) }));
}

// The axes on which a cell is a parent member (its value can be derived from its children there).
export function rollupAxesOf(A, concept, dims) {
  if (!rollsUp(A, concept)) return [];
  const trees = memberTrees(A);
  return dims.filter((d) => d.member && trees.get(d.axis)?.childrenOf.has(d.member)).map((d) => d.axis);
}
