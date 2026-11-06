import * as XLSX from 'xlsx';
import { toCanonical, toDisplay } from './scaling.js';

const LABEL_HEADERS = new Set(['particulars', 'line item', 'description', 'account', 'account name', 'item', 'head']);

export function normalizeExcelLabel(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function parseExcelAmount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const text = String(value).trim();
  if (!text || /^[-–—]$/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[₹,\s]/g, '').replace(/^(?:INR|Rs\.?)/i, '').replace(/^\((.*)\)$/, '$1');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const normalized = negative && !cleaned.startsWith('-') ? `-${cleaned}` : cleaned;
  return Number.isFinite(Number(normalized)) ? normalized : null;
}

export function excelDisplayValue(value, concept, A, sourceLevel, filingLevel) {
  return A.isMonetary(concept) ? toDisplay(toCanonical(value, sourceLevel), filingLevel) : value;
}

export function excelImportReadiness(periods, firstFinancialYear, rows) {
  if (!periods?.cy?.start || !periods.cy.end) return { ready: false, reason: 'Set the current-year start and end dates on the Company information page before importing.' };
  const hasPreviousValues = rows.some((row) => row.py != null);
  if (hasPreviousValues && !firstFinancialYear && (!periods.py?.start || !periods.py.end)) {
    return { ready: false, reason: 'Set the previous-year start and end dates on the Company information page before importing both workbook years.' };
  }
  return { ready: true, skipPrevious: hasPreviousValues && !!firstFinancialYear, reason: '' };
}

function sheetType(name, rows) {
  const key = normalizeExcelLabel(name);
  if (/balance sheet|financial position|\bbs\b/.test(key)) return 'balance';
  if (/profit|loss|income statement|\bp and l\b|\bp l\b/.test(key)) return 'profit-loss';
  const sample = rows.slice(0, 12).flat().map(normalizeExcelLabel).join(' ');
  if (/balance sheet|statement of financial position/.test(sample)) return 'balance';
  if (/statement of profit and loss|profit and loss statement|income statement/.test(sample)) return 'profit-loss';
  return null;
}

function headerScope(value, periods) {
  const key = normalizeExcelLabel(value);
  if (/\b(current|current year|cy)\b/.test(key)) return 'CY';
  if (/\b(previous|prior|previous year|prior year|py)\b/.test(key)) return 'PY';
  const years = [...key.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (periods?.cy?.end && years.includes(Number(periods.cy.end.slice(0, 4)))) return 'CY';
  if (periods?.py?.end && years.includes(Number(periods.py.end.slice(0, 4)))) return 'PY';
  return null;
}

function parseSheet(sheetName, rows, type, periods) {
  let headerRow = -1, labelColumn = 0;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r] || [];
    const col = cells.findIndex((v) => LABEL_HEADERS.has(normalizeExcelLabel(v)));
    if (col >= 0) { headerRow = r; labelColumn = col; break; }
  }
  const valueColumns = { CY: null, PY: null };
  if (headerRow >= 0) {
    const cells = rows[headerRow] || [];
    for (let c = 0; c < cells.length; c++) {
      const scope = headerScope(cells[c], periods);
      if (scope && valueColumns[scope] == null) valueColumns[scope] = c;
    }
    const numericColumns = cells.map((_, c) => c).filter((c) => c !== labelColumn);
    if (valueColumns.CY == null) valueColumns.CY = numericColumns[0] ?? null;
    if (valueColumns.PY == null) valueColumns.PY = numericColumns.find((c) => c !== valueColumns.CY) ?? null;
  } else {
    valueColumns.CY = 1;
    valueColumns.PY = 2;
  }
  const start = headerRow + 1;
  const items = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] || [];
    const lineItem = String(row[labelColumn] ?? '').trim();
    if (!lineItem) continue;
    const cy = valueColumns.CY == null ? null : parseExcelAmount(row[valueColumns.CY]);
    const py = valueColumns.PY == null ? null : parseExcelAmount(row[valueColumns.PY]);
    if (cy == null && py == null) continue;
    items.push({ lineItem, cy, py, type, sheetName, sourceRow: i + 1 });
  }
  return items;
}

export function parseExcelWorkbook(data, { periods = null } = {}) {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false, raw: true });
  const rows = [];
  const ignoredSheets = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const type = sheetType(sheetName, sheetRows);
    if (!type) { ignoredSheets.push(sheetName); continue; }
    rows.push(...parseSheet(sheetName, sheetRows, type, periods));
  }
  if (!rows.length) throw new Error('No Balance Sheet or Profit and Loss rows with numeric values were found. Name a worksheet accordingly and include a Particulars/Line Item column.');
  return { rows, ignoredSheets };
}

export function statementTargets(A, S, type) {
  const code = type === 'balance' ? '100100' : '100200';
  const elr = A.elrByCode(code);
  if (!elr) return [];
  const seen = new Set();
  return S.elrView(elr.uri).rows.filter((row) => {
    if (row.kind !== 'item' || !A.isNumeric(row.concept) || seen.has(row.concept)) return false;
    seen.add(row.concept);
    return true;
  }).map((row) => ({ concept: row.concept, label: row.label || A.label(row.concept), elrUri: elr.uri }));
}

export function suggestExcelTargets(A, targets, lineItem) {
  const wanted = normalizeExcelLabel(lineItem);
  if (!wanted) return [];
  return targets.filter((target) => {
    const labels = Object.values(A.concept(target.concept)?.labels || {});
    return [target.label, A.label(target.concept), ...labels, target.concept.split(':').at(-1)].some((label) => normalizeExcelLabel(label) === wanted);
  });
}