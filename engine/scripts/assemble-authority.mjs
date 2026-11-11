// Joins the two knowledge-base halves of each engine authority into engine/authority/<id>.authority.json, for
// tests and tools that run without the sidecar (ADR-0011). Nothing is compiled here: the taxonomy half is built by
// `make engine-authority`, the business rules by `make engine-rules`; the app loads both through sidecar routes.
// Skips a taxonomy whose output is newer than its inputs. Deterministic.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleAuthority } from '../src/core/authority-bundle.js';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(ENGINE, '..');
export const KB_DIR = path.join(REPO_ROOT, 'knowledge_base');
export const OUT_DIR = path.join(ENGINE, 'authority');

/** app taxonomy id → knowledge-base file stem */
export const TAXONOMIES = { 'ci-2016': 'ci', 'ind-as-2017': 'ind_as' };

export const taxonomyFile = (id) => path.join(KB_DIR, `${TAXONOMIES[id]}_engine_authority.json`);
export const rulesFile = (id) => path.join(KB_DIR, `${TAXONOMIES[id]}_engine_rules.json`);
export const coverageFile = (id) => path.join(KB_DIR, `${TAXONOMIES[id]}_rule_coverage.json`);
export const authorityFile = (id) => path.join(OUT_DIR, `${id}.authority.json`);

export function loadTaxonomyAuthority(id = 'ci-2016') {
  const file = taxonomyFile(id);
  if (!existsSync(file)) throw new Error(`Taxonomy authority not found: ${file}. Build it with "make engine-authority".`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function assemble(id, { force = false } = {}) {
  const inputs = [taxonomyFile(id), rulesFile(id)].filter(existsSync);
  const out = authorityFile(id);
  if (!force && existsSync(out) && inputs.every((f) => statSync(f).mtimeMs <= statSync(out).mtimeMs)) return { id, skipped: true };
  const rules = existsSync(rulesFile(id)) ? JSON.parse(readFileSync(rulesFile(id), 'utf8')) : null;
  const authority = assembleAuthority(loadTaxonomyAuthority(id), rules);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(out, JSON.stringify(authority));
  return { id, skipped: false, rules: rules ? rules.businessRules.rules.length : 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const force = process.argv.includes('--force');
  for (const id of Object.keys(TAXONOMIES)) {
    const r = assemble(id, { force });
    console.log(r.skipped ? `${id}: up to date` : `${id}: assembled (${r.rules} rules) -> ${path.relative(REPO_ROOT, authorityFile(id))}`);
  }
}
