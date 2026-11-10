/** Engine authorities for service tests without a sidecar: the route's payload read from knowledge_base/. */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { TaxonomyId } from '@xap/engine/basics'
import { FileRuleBundleSource } from '../../electron/main/infra/file-authority-provider'
import { AuthorityService } from '../../electron/main/services/authority-service'
import type { AuthorityJson, TaxonomyAuthoritySource } from '../../electron/main/services/ports'

export const KB_DIR = resolve(__dirname, '../../../knowledge_base')
export const RULES_DIR = resolve(__dirname, '../../../engine/authority')
export const KB_FILES: Partial<Record<TaxonomyId, string>> = {
  'ci-2016': join(KB_DIR, 'ci_engine_authority.json'),
  'ind-as-2017': join(KB_DIR, 'ind_as_engine_authority.json'),
}
export const kbReady = Object.values(KB_FILES).every((f) => existsSync(f!)) && existsSync(join(RULES_DIR, 'ci-2016.rules.json'))

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

export const kbAuthorityService = (source: TaxonomyAuthoritySource = new KbAuthoritySource()) =>
  new AuthorityService(source, new FileRuleBundleSource(RULES_DIR))
