/** Engine authorities for service tests without a sidecar: the route's payload read from knowledge_base/. */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { TaxonomyId } from '@xap/engine/basics'
import { AuthorityService } from '../../electron/main/services/authority-service'
import type { AuthorityJson, RuleBundleSource, TaxonomyAuthoritySource } from '../../electron/main/services/ports'

export const KB_DIR = resolve(__dirname, '../../../knowledge_base')
const KB_STEM: Partial<Record<TaxonomyId, string>> = { 'ci-2016': 'ci', 'ind-as-2017': 'ind_as' }
export const KB_FILES: Partial<Record<TaxonomyId, string>> = Object.fromEntries(
  Object.entries(KB_STEM).map(([t, stem]) => [t, join(KB_DIR, `${stem}_engine_authority.json`)]),
)
export const KB_RULE_FILES: Partial<Record<TaxonomyId, string>> = Object.fromEntries(
  Object.entries(KB_STEM).map(([t, stem]) => [t, join(KB_DIR, `${stem}_engine_rules.json`)]),
)
export const kbReady = Object.values(KB_FILES).every((f) => existsSync(f!)) && existsSync(KB_RULE_FILES['ci-2016']!)

export class KbAuthoritySource implements TaxonomyAuthoritySource {
  calls = 0
  failNext = false
  async taxonomyAuthority(taxonomy: TaxonomyId): Promise<AuthorityJson> {
    this.calls++
    if (this.failNext) {
      this.failNext = false
      throw new Error('sidecar restarting')
    }
    const file = KB_FILES[taxonomy]
    if (!file) throw new Error(`no engine authority for ${taxonomy}`)
    return JSON.parse(readFileSync(file, 'utf8'))
  }
}

/** The /engine-rules route's payload read from knowledge_base/ (null when the taxonomy has no rules). */
export class KbRuleBundleSource implements RuleBundleSource {
  async rules(taxonomy: TaxonomyId): Promise<AuthorityJson | null> {
    const file = KB_RULE_FILES[taxonomy]
    return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  }
}

export const kbAuthorityService = (source: TaxonomyAuthoritySource = new KbAuthoritySource()) =>
  new AuthorityService(source, new KbRuleBundleSource())
