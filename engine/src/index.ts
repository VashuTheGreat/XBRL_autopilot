/**
 * @xap/engine: deterministic XBRL core. Import from '@xap/engine/basics' where only types and small
 * helpers are needed (renderer); this entry pulls in the whole engine.
 */
export * from './basics'

// ---------------------------------------------------------------------------------------------
// Core engine (behaviour-preserving port of lagacy_js; see docs/04-xbrl-engine.md).
// Modules in ./core are JS for now and are converted to TS one at a time; the public surface
// below is the stable API the app uses.
// ---------------------------------------------------------------------------------------------
export { Authority } from './core/authority.js'
export { assembleAuthority, emptyRuleModel, AuthorityMismatchError } from './core/authority-bundle.js'
export { Session, DimensionError, CalculatedCellError, PyLockedError } from './core/session.js'
export { Filing, FactValueError, factKey, dimKey, normDims, defaultMeta } from './core/model.js'
export { generateInstance, buildContexts } from './core/generator.js'
export { importInstance, CashFlowChoiceError, detectCashFlow } from './core/importer.js'
export { Gate, GateError, exportXml, htmlGuidelineIssues, SHARE_CAPITAL } from './core/gate.js'
export { RuleEngine } from './core/rules.js'
export { runCalculations, calculationNetworks } from './core/calculation.js'
export { explainMcaErrors } from './core/mca-errors.js'
export { fixFor } from './core/fixes.js'
export { toMca, fromMca, tidy as tidyRichText, plainText } from './core/richtext.js'
export { buildPreviewHtml, groupIN, formatValue } from './core/pdf-preview.js'
export { buildElrView, buildTableView, tableSlices } from './core/views.js'
export { SCALE_POWERS, toCanonical, toDisplay } from './core/scaling.js'
export { compareFilings } from './core/compare.js'
export { carryForwardPlan, carryForward, disclosureCarryPlan, disclosureCarry, previousYearValues } from './core/carry-forward.js'
export { buildExample, completeMandatory } from './core/example.js'
export * as decimal from './core/decimal.js'
export { indexFactLines } from './xml-index'
export {
  importXbrl,
  readSchemaRef,
  canonicalFacts,
  compareInstanceFacts,
  verifyRoundTrip,
  instanceConventions,
  type ImportMode,
  type ImportedInstance,
  type InstanceComparison,
  type InstanceConventions,
  type FactDifference,
} from './instance-import'
export { nondimAllowed } from './core/dimensions.js'
export {
  mandatoryZeroPlan,
  fillMandatoryZeros,
  tableZeroPlan,
  fillTableMandatoryZeros,
  type ZeroFill,
  type TableZeroFill,
  type TableDim,
} from './mandatory-zeros'
export {
  planTableBlock,
  tableOfFact,
  UnknownTableError,
  NO_MEMBER,
  type TableBlockSpec,
  type TableBlockRow,
  type TableBlockColumn,
  type PlannedTableFact,
  type PlannedAlsoFact,
  type TableBlockAlsoItem,
  type TableScope,
} from './table-mapping'
export {
  checkPatch,
  applyFactPatch,
  dryRun,
  isFactPatch,
  PatchError,
  type FixPatch,
  type FactPatch,
  type PatchCheck,
  type PatchCell,
  type PatchFactTarget,
  type PatchScope,
  type PatchSource,
  type DryRunResult,
} from './patches'
