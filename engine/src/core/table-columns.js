// The columns of a table as the mandatory-line-items rules see them. Shared by the rule engine (rules.js
// lineItemsMandatory), the mandatory marks (mandatory-marks.js) and the table zero fill (../mandatory-zeros.ts), so
// "a column has a value" and "this line item is missing" mean the same thing everywhere.
import { tablesForFact } from './dimensions.js';
import { reportingYear } from './periods.js';
import { dimKey } from './model.js';

// tables whose line items may be given against one member only ("lineItemSingleMember" rules, e.g. SR-L3717-1)
const SINGLE = new WeakMap();
export function singleMemberTables(A) {
  if (!SINGLE.has(A)) SINGLE.set(A, new Set(A.rules.rules.filter((r) => r.status === 'EXECUTABLE' && r.ast?.type === 'lineItemSingleMember').flatMap((r) => r.ast.tables)));
  return SINGLE.get(A);
}

// The dimension combinations (columns) of table `id` that hold a value for reporting year `scope`: the table's own
// line items, not nil, every axis one of the table's, not the previous year's opening balance. dimKey → dims.
export function filledTableColumns(A, filing, id, scope) {
  const t = A.table(id);
  const items = new Set(t.lineItems);
  const axes = new Set(t.axes.map((x) => x.axis));
  const groups = new Map();
  for (const f of filing.all()) {
    if (!items.has(f.concept) || f.nil || !f.dims.length || !f.dims.every((d) => axes.has(d.axis))) continue;
    if (!tablesForFact(A, f).some((x) => x.hypercube === t.hypercube)) continue;
    if (reportingYear(filing.meta.periods, f.period) !== scope || filing.scopeOf(f.period) === 'PYO') continue;
    groups.set(dimKey(f.dims), f.dims);
  }
  return groups;
}
