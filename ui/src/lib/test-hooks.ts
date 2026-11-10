/**
 * Dev-only hooks for automated end-to-end runs (window.__xap_test__). Compiled out of production builds:
 * `import.meta.env.DEV` is a build-time constant, so the body below is dead code in `pnpm build`.
 */
export function registerTestHook(name: string, value: unknown): void {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __xap_test__?: Record<string, unknown> }
  w.__xap_test__ ??= {}
  w.__xap_test__[name] = value
}
