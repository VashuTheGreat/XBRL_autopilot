/**
 * In-memory migrations of older `.axbrl` content (docs/03-project-file-axbrl.md "Version migration"): an old file is
 * upgraded on open and written in the current format on the next save. Pure functions, unit-tested.
 */

/** mapping.json version this app writes. */
export const MAPPING_VERSION = 2

interface MappingJson {
  version: number
  entries: unknown[]
  [key: string]: unknown
}

type EntryV1 = { cell?: unknown; sign?: unknown; sources?: unknown }

/**
 * mapping.json v1 → v2 (ADR-0015): an entry's one cell becomes a list of one source, `sources: [{ cell, sign }]`.
 * Entries that already have sources, and everything else in the file, are kept as they are.
 */
export function migrateMapping<T extends MappingJson>(mapping: T): T {
  if (mapping.version >= MAPPING_VERSION) return mapping
  const entries = (mapping.entries ?? []).map((raw) => {
    const e = raw as EntryV1
    if (Array.isArray(e.sources) || !e.cell) return raw
    return { ...e, sources: [{ cell: e.cell, sign: e.sign === -1 ? -1 : 1 }] }
  })
  return { ...mapping, version: MAPPING_VERSION, entries }
}
