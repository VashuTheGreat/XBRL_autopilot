import { describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../electron/main/infra/app-database'
import { ValidationError } from '../electron/main/services/errors'
import type { SecretStore } from '../electron/main/services/ports'
import { DEFAULT_SETTINGS, SettingsService } from '../electron/main/services/settings-service'

class MemorySecretStore implements SecretStore {
  value: string | null = null
  constructor(private readonly available = true) {}
  async isAvailable() { return this.available }
  async get() { return this.value }
  async set(v: string) { this.value = v }
  async clear() { this.value = null }
}

const KEY = 'gsk_' + 'a'.repeat(52)

describe('SettingsService', () => {
  it('returns defaults, persists updates and clamps the autosave interval', async () => {
    const db = new AppDatabase(':memory:')
    const s = new SettingsService(db, new MemorySecretStore())
    expect(s.get()).toEqual(DEFAULT_SETTINGS)
    await s.update({ mcaToolPath: '  C:\\MCA\\tool.exe ', autosaveSeconds: 3 })
    expect(new SettingsService(db, new MemorySecretStore()).get()).toMatchObject({ mcaToolPath: 'C:\\MCA\\tool.exe', autosaveSeconds: 10 })
  })

  it('stores the Groq key only in the secret store and never exposes it in state', async () => {
    const secrets = new MemorySecretStore()
    const s = new SettingsService(new AppDatabase(':memory:'), secrets)
    const onAi = vi.fn()
    s.on('ai-config-changed', onAi)
    const state = await s.setGroqKey(`  ${KEY} `)
    expect(secrets.value).toBe(KEY)
    expect(JSON.stringify(state)).not.toContain('gsk_')
    expect(state).toMatchObject({ hasGroqKey: true, groqKeyFromEnv: false })
    expect(await s.groqKey()).toBe(KEY)
    expect(onAi).toHaveBeenCalledTimes(1)
    await s.clearGroqKey()
    expect((await s.state()).hasGroqKey).toBe(false)
  })

  it('rejects malformed keys', async () => {
    const s = new SettingsService(new AppDatabase(':memory:'), new MemorySecretStore())
    await expect(s.setGroqKey('sk-123')).rejects.toThrow(ValidationError)
  })

  it('falls back to the dev .env key, a stored key wins', async () => {
    const secrets = new MemorySecretStore()
    const s = new SettingsService(new AppDatabase(':memory:'), secrets, 'gsk_' + 'e'.repeat(52))
    expect(await s.state()).toMatchObject({ hasGroqKey: true, groqKeyFromEnv: true })
    await s.setGroqKey(KEY)
    expect(await s.groqKey()).toBe(KEY)
    expect((await s.state()).groqKeyFromEnv).toBe(false)
  })

  it('signals a sidecar restart when the model changes, not for other settings', async () => {
    const s = new SettingsService(new AppDatabase(':memory:'), new MemorySecretStore())
    const onAi = vi.fn()
    s.on('ai-config-changed', onAi)
    await s.update({ autosaveSeconds: 60 })
    expect(onAi).not.toHaveBeenCalled()
    await s.update({ groqModel: 'openai/gpt-oss-20b' })
    expect(onAi).toHaveBeenCalledTimes(1)
  })
})
