import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { authority } from './helpers.mjs';
import { buildExample } from './example.js';
import { Session } from './session.js';
import { excelDisplayValue, excelImportReadiness, normalizeExcelLabel, parseExcelAmount, parseExcelWorkbook, statementTargets, suggestExcelTargets } from './excel-import.js';

const A = authority();

function workbookBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

test('Excel statement rows detect CY/PY headers, parse Indian amounts, and ignore other sheets', () => {
  const data = workbookBuffer([
    ['Balance Sheet', [['Particulars', 'Current Year', 'Previous Year'], ['Share Capital', 100, 90], ['Trade payables', '(1,23,456.50)', '-']]],
    ['Notes', [['Particulars', 'Current Year'], ['Anything', 1]]],
  ]);
  const parsed = parseExcelWorkbook(data);
  assert.deepEqual(parsed.rows.map(({ lineItem, cy, py }) => [lineItem, cy, py]), [
    ['Share Capital', '100', '90'],
    ['Trade payables', '-123456.50', null],
  ]);
  assert.deepEqual(parsed.ignoredSheets, ['Notes']);
});

test('period-date headers map to the filing years; strict numeric parsing rejects trailing text', () => {
  const data = workbookBuffer([['Statement of Profit and Loss', [
    ['Particulars', 'Year ended 31 March 2025', 'Year ended 31 March 2024'],
    ['Revenue from operations', '12,500', 11000],
  ]]]);
  const parsed = parseExcelWorkbook(data, { periods: { cy: { end: '2025-03-31' }, py: { end: '2024-03-31' } } });
  assert.deepEqual([parsed.rows[0].cy, parsed.rows[0].py], ['12500', '11000']);
  assert.equal(parseExcelAmount('12abc'), null);
  assert.equal(parseExcelAmount('  ₹ 1,234.50 '), '1234.50');
  assert.equal(parseExcelAmount('(50)'), '-50');
  assert.equal(normalizeExcelLabel('Trade & Payables'), 'trade and payables');
});

test('suggestions are exact and monetary values convert between source and filing scales', () => {
  const S = new Session(A);
  buildExample(S);
  const targets = statementTargets(A, S, 'balance');
  const matches = suggestExcelTargets(A, targets, 'Share Capital');
  assert.ok(matches.some((x) => x.concept === A.qnameOfLocal('ShareCapital')));
  assert.deepEqual(suggestExcelTargets(A, targets, 'Share Cap'), []);
  assert.equal(excelDisplayValue('1.25', A.qnameOfLocal('ShareCapital'), A, 'Lakhs', 'Actual'), '125000');
  assert.equal(excelDisplayValue('1.25', A.qnameOfLocal('NumberOfSharesOutstanding'), A, 'Lakhs', 'Actual'), '1.25');
});

test('import requires real reporting periods and skips PY values in first-financial-year filings', () => {
  const rows = [{ cy: '1', py: '2' }];
  assert.equal(excelImportReadiness({ cy: {}, py: {} }, false, rows).ready, false);
  const cyOnly = { cy: { start: '2025-04-01', end: '2026-03-31' }, py: {} };
  assert.equal(excelImportReadiness(cyOnly, false, rows).ready, false);
  assert.deepEqual(excelImportReadiness(cyOnly, true, rows), { ready: true, skipPrevious: true, reason: '' });
  assert.deepEqual(excelImportReadiness({ ...cyOnly, py: { start: '2024-04-01', end: '2025-03-31' } }, false, rows), { ready: true, skipPrevious: false, reason: '' });
});