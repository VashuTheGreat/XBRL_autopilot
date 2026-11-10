import type { XapApi } from '../../shared/ipc'

declare global {
  interface Window {
    xap: XapApi
  }
}

export {}
