/**
 * Monaco, bundled (no CDN: this is an offline desktop app). Only the core editor worker and the XML grammar.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/languages/definitions/xml/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

export { monaco }
