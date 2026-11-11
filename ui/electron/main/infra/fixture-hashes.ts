/** Reads the client fixtures in data/ (top level) for the FixtureGuard. Dev only: the packaged app has no data/. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fixtureDigest, HashFixtureGuard } from '../services/fixture-guard'

/** Synthetic files in data/ that are not client data (the sample workbook the E2E uses). */
export const NOT_CLIENT_DATA = new Set(['sample_financials.xlsx'])
const CLIENT_FILE = /\.(xml|xls|xlsx|xlsm|pdf)$/i

export function fixtureGuardFrom(dataDir: string): HashFixtureGuard {
  if (!existsSync(dataDir)) return new HashFixtureGuard([])
  const files = readdirSync(dataDir)
    .filter((n) => CLIENT_FILE.test(n) && !NOT_CLIENT_DATA.has(n.toLowerCase()))
    .filter((n) => statSync(join(dataDir, n)).isFile())
    .map((name) => ({ name, digest: fixtureDigest(name, new Uint8Array(readFileSync(join(dataDir, name)))) }))
  return new HashFixtureGuard(files)
}
