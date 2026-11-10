// Suite: business-rule corpus ingestion — text export and original workbook (.xlsx/.xls) read identically;
// the workbook form has no export row limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { readWorkbook, specificRules, genericRules, mandatoryLineItemSheets } from '../../compiler/rules-source.mjs';

import { RULES_WORKBOOK } from '../../compiler/compile.mjs';
import { fileURLToPath } from 'node:url';
// The tab-separated text export of the rule workbook (legacy evidence) is not in this repo; tests that need it skip.
const TXT = fileURLToPath(new URL('../fixtures/Final_Business_Rule_C_I_Taxonomy_2016_V1.3.xls.txt', import.meta.url));
const NO_TXT = !existsSync(TXT) && 'text export of the rule workbook not in repo (engine/test/fixtures/)';

const COV = JSON.parse(readFileSync(new URL('../../authority/ci-2016.coverage.json', import.meta.url), 'utf8'));
const SOURCE = RULES_WORKBOOK; // COV.corpus.sourceFile holds the file name only

test('corpus inventory of the compiled rule source: complete original workbook, no truncation', () => {
  const wb = readWorkbook(SOURCE);
  assert.equal(wb.form, 'workbook', 'compiled from the original .xls/.xlsx, not a text export');
  const names = wb.sheets.map((s) => s.name);
  for (const n of ['Changes to Business Rules', 'Specific rules for elements', 'Generic rules', 'Applicable ELR', 'Mandatory Line Items', 'Exempt parent member Dimension', 'Exempt Child Member Dimension', 'Parent Child Exempt Calculation', 'Country Codes']) assert.ok(names.includes(n), n);
  const spec = specificRules(wb);
  assert.equal(spec.truncated, false);
  assert.ok(wb.sheets.every((s) => !s.truncated));
  assert.equal(COV.corpus.specificRulesSheetTruncated, false);
  assert.equal(COV.corpus.specificRuleRows, spec.rows.length);
  assert.equal(COV.corpus.genericRuleCount, genericRules(wb).length);
  assert.equal(COV.corpus.mandatoryLineItemRows, mandatoryLineItemSheets(wb)[0].rows.length);
  assert.equal(spec.lastElr.code, '400500', 'specific rules reach the last ELR of the taxonomy');
  assert.match(COV.corpus.sourceSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(COV.corpus.elrsWithoutSuppliedSpecificRules, []);
  console.log(`# corpus: ${SOURCE} sha256=${COV.corpus.sourceSha256} sheets=${names.length} specificRows=${spec.rows.length} generic=${genericRules(wb).length} ML=${mandatoryLineItemSheets(wb)[0].rows.length} lastELR=${spec.lastElr?.code}`);
});

test('the earlier text export is a truncated prefix of the complete workbook (same rows, nothing altered)', { skip: NO_TXT }, () => {
  const txt = specificRules(readWorkbook(TXT));
  const full = specificRules(readWorkbook(SOURCE));
  assert.equal(txt.truncated, true);
  assert.ok(full.rows.length > txt.rows.length);
  const norm = (r) => [r.element, r.text.replace(/\s+/g, ' ').trim()];
  // the export's last row is cut by the export limit; every earlier row is identical in the workbook
  assert.deepEqual(full.rows.slice(0, txt.rows.length - 1).map(norm), txt.rows.slice(0, -1).map(norm));
});

test('original workbook form: every sheet and row is read; no truncation marker; same records as the export', { skip: NO_TXT }, () => {
  const txt = readWorkbook(TXT);
  // write the export's rows back into a real .xlsx workbook (structure test of the binary reader, no new content)
  const book = XLSX.utils.book_new();
  for (const s of txt.sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.cells)), s.name.slice(0, 31));
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'wb-')), 'rules.xlsx');
  writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const bin = readWorkbook(file);
  assert.equal(bin.form, 'workbook');
  assert.equal(bin.sheets.length, txt.sheets.length);
  for (const [i, s] of bin.sheets.entries()) {
    assert.equal(s.truncated, false);
    assert.equal(s.rows.length, txt.sheets[i].rows.length, s.name);
  }
  const a = specificRules(txt).rows.map((r) => [r.element, r.text]);
  const b = specificRules(bin).rows.map((r) => [r.element, r.text]);
  assert.deepEqual(b, a);
  assert.equal(specificRules(bin).truncated, false);
});
