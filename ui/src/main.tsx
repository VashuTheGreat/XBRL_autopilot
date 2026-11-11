import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { registerTestHook } from './lib/test-hooks'
import { useEditor } from './stores/editor'
import { useValidation } from '@/stores/validation'
import { useAi } from '@/stores/ai'
import { useProject } from './stores/project'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerTestHook('editor', useEditor)
registerTestHook('project', useProject)
registerTestHook('validation', useValidation)
registerTestHook('ai', useAi)
