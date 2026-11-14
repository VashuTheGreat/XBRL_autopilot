/**
 * A TaxonomyCatalog read straight from the open project's engine authority (statement list + presentation trees), for
 * service tests that build the Form without a sidecar. The app itself reads both from the FastAPI routes.
 */
import type { ElrInfo } from '@shared/project'
import type { ElrTreeNode, ProjectAccess, TaxonomyCatalog } from '../../electron/main/services/ports'

type Authority = {
  elrs: (ElrInfo & { roots: string[] })[]
  concept(q: string): { abstract?: boolean; periodType?: 'instant' | 'duration' } | null
  label(q: string, role?: string): string
  presentationChildren(elr: string, from: string): { to: string; preferredLabel?: string }[]
}

export function authorityCatalog(projects: ProjectAccess): TaxonomyCatalog {
  const A = () => projects.project().authority.authority as unknown as Authority
  const node = (a: Authority, uri: string, q: string, preferredLabel?: string): ElrTreeNode => ({
    qname: q,
    label: a.label(q, preferredLabel || 'label'),
    abstract: !!a.concept(q)?.abstract,
    type: null,
    periodType: a.concept(q)?.periodType ?? null,
    balance: null,
    children: a.presentationChildren(uri, q).map((arc) => node(a, uri, arc.to, arc.preferredLabel)),
  })
  return {
    elrs: async () => A().elrs.map(({ uri, code, title, group }) => ({ uri, code, title, group })),
    elrTree: async (_taxonomy, code) => {
      const a = A()
      const e = a.elrs.find((x) => x.code === code)!
      return { uri: e.uri, code: e.code, title: e.title, group: e.group, tree: e.roots.map((q) => node(a, e.uri, q)) }
    },
    searchConcepts: async () => [],
  }
}
