import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateToken,
  getFreePort,
  isAllowedSidecarPath,
  parseHealth,
  resolveSidecarLaunch,
  restartDelayMs,
} from '../electron/main/sidecar-utils'

describe('isAllowedSidecarPath', () => {
  it('allows health and versioned API routes', () => {
    expect(isAllowedSidecarPath('/health')).toBe(true)
    expect(isAllowedSidecarPath('/api/v1/taxonomies')).toBe(true)
    expect(isAllowedSidecarPath('/api/v1/taxonomies/ci_taxonomy/concepts?search=share')).toBe(true)
  })
  it('rejects traversal, absolute URLs and other paths', () => {
    expect(isAllowedSidecarPath('/api/v1/../docs')).toBe(false)
    expect(isAllowedSidecarPath('http://evil/api/v1/x')).toBe(false)
    expect(isAllowedSidecarPath('/docs')).toBe(false)
    expect(isAllowedSidecarPath('api/v1/x')).toBe(false)
    expect(isAllowedSidecarPath('/api/v1\\x')).toBe(false)
  })
})

describe('resolveSidecarLaunch', () => {
  it('uses uv from the repo root in dev', () => {
    const l = resolveSidecarLaunch({ isPackaged: false, repoRoot: 'R', resourcesPath: 'X', platform: 'win32' })
    expect(l).toEqual({ command: 'uv', args: ['run', 'python', '-m', 'api'], cwd: 'R' })
  })
  it('uses the bundled exe when packaged', () => {
    const l = resolveSidecarLaunch({ isPackaged: true, repoRoot: 'R', resourcesPath: 'X', platform: 'win32' })
    expect(l.command).toBe(join('X', 'sidecar', 'xap-sidecar.exe'))
    expect(l.args).toEqual([])
  })
})

describe('parseHealth', () => {
  it('accepts a valid payload', () => {
    expect(parseHealth({ status: 'ok', version: '0.1.0', ai: { enabled: true, model: 'm' } })).toEqual({
      status: 'ok',
      version: '0.1.0',
      ai: { enabled: true, model: 'm' },
    })
  })
  it('rejects anything else', () => {
    expect(parseHealth(null)).toBeNull()
    expect(parseHealth({ status: 'down', version: '1' })).toBeNull()
    expect(parseHealth({ status: 'ok' })).toBeNull()
  })
})

describe('misc', () => {
  it('generates 64-hex-char tokens', () => {
    const t = generateToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
    expect(generateToken()).not.toBe(t)
  })
  it('backs off exponentially with a cap', () => {
    expect([0, 1, 2, 3, 10].map(restartDelayMs)).toEqual([1000, 2000, 4000, 8000, 10000])
  })
  it('finds a free loopback port', async () => {
    const p = await getFreePort()
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(65536)
  })
})
