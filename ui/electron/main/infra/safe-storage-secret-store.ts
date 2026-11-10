import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'
import type { SecretStore } from '../services/ports'

/**
 * Stores one secret encrypted with Electron safeStorage (DPAPI on Windows, tied to the OS user).
 * The plaintext never touches disk and is never sent to the renderer.
 */
export class SafeStorageSecretStore implements SecretStore {
  constructor(private readonly file: string) {}

  isAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable()
  }

  async get(): Promise<string | null> {
    if (!existsSync(this.file) || !(await this.isAvailable())) return null
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await readFile(this.file))
      if (shouldReEncrypt) await this.set(result) // OS key rotated: refresh the ciphertext
      return result
    } catch {
      return null // different OS user / corrupted: behave as "no key"
    }
  }

  async set(value: string): Promise<void> {
    if (!(await this.isAvailable())) throw new Error('Secure storage is not available on this system; the key cannot be saved.')
    await writeFile(this.file, await safeStorage.encryptStringAsync(value))
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true })
  }
}
