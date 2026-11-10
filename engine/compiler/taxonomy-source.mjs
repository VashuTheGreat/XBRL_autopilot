// Working copy of the MCA C&I 2016 taxonomy for the test-side XML Schema check (xsd-validate.mjs, Arelle).
//
// Source: the published package in data/. Working copy: engine/.taxonomy/Taxonomy-2016-03-31/ (git-ignored),
// with the validator patches applied. The patches are not defined here: they come from the taxonomy authority
// built by the Python ingestion (meta.validatorPatches, src/services/engine_authority/specs.py), so the engine
// and the XSD check always see the same taxonomy. A patch whose original text is missing fails loudly.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaxonomyAuthority, REPO_ROOT } from './compile.mjs';

export { REPO_ROOT };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // engine/
export const DATA_TAXONOMY_ROOT = path.join(
  REPO_ROOT, 'data', 'c&I taxonomy', 'Final C and I Taxonomy 2016 V1.2@31-03-2016', 'Taxonomy-2016-03-31',
);
export const TAXONOMY_DIR = path.join(ROOT, '.taxonomy');
export const TAXONOMY_ROOT = path.join(TAXONOMY_DIR, 'Taxonomy-2016-03-31');
const MARKER = path.join(TAXONOMY_DIR, '.validator-update');

/** Validator patches { file, reason, find, replace } of the C&I taxonomy build. */
export function validatorPatches() {
  return loadTaxonomyAuthority().meta.validatorPatches || [];
}

/** Applies the patches that are not applied yet. Returns [{ file, bytes }] for the files changed now. */
export function validatorUpdates() {
  const updated = [];
  for (const p of validatorPatches()) {
    const target = path.join(TAXONOMY_ROOT, p.file);
    const text = readFileSync(target, 'utf8');
    if (text.includes(p.replace)) continue; // already applied
    const count = text.split(p.find).length - 1;
    if (count !== 1) throw new Error(`Validator patch for ${p.file}: expected the original text exactly once, found ${count}`);
    const next = text.replace(p.find, p.replace);
    writeFileSync(target, next);
    updated.push({ file: p.file, bytes: Buffer.byteLength(next) });
  }
  return updated;
}

export function ensureTaxonomy() {
  if (!existsSync(path.join(DATA_TAXONOMY_ROOT, 'in-ci-ent-2016-03-31.xsd'))) {
    throw new Error(`C&I 2016 taxonomy not found at ${DATA_TAXONOMY_ROOT}`);
  }
  const stamp = JSON.stringify(validatorPatches().map((p) => [p.file, p.find, p.replace]));
  if (existsSync(path.join(TAXONOMY_ROOT, 'in-ci-ent-2016-03-31.xsd')) && existsSync(MARKER)
    && JSON.parse(readFileSync(MARKER, 'utf8')).stamp === stamp) return TAXONOMY_ROOT;
  rmSync(TAXONOMY_DIR, { recursive: true, force: true });
  mkdirSync(TAXONOMY_DIR, { recursive: true });
  cpSync(DATA_TAXONOMY_ROOT, TAXONOMY_ROOT, { recursive: true });
  const updated = validatorUpdates();
  writeFileSync(MARKER, JSON.stringify({ stamp, source: path.relative(REPO_ROOT, DATA_TAXONOMY_ROOT).replaceAll('\\', '/'), updated }, null, 1));
  return TAXONOMY_ROOT;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  ensureTaxonomy();
  console.log(readFileSync(MARKER, 'utf8'));
}
