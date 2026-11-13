import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: string[]
}

export interface ConversationThread {
  thread_id: string
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

interface ChatStore {
  threads: ConversationThread[]
  activeThreadId: string | null
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  error: string | null

  init(): Promise<void>
  loadThreads(): Promise<void>
  selectThread(threadId: string): Promise<void>
  createThread(title?: string): Promise<string | null>
  deleteThread(threadId: string): Promise<void>
  sendMessage(text: string): Promise<void>
  clearError(): void
}

export const useChat = create<ChatStore>((set, get) => {
  const api = () => window.xap?.sidecar

  return {
    threads: [],
    activeThreadId: null,
    messages: [],
    loading: false,
    sending: false,
    error: null,

    clearError: () => set({ error: null }),

    init: async () => {
      if (!window.xap?.sidecar) return
      await get().loadThreads()
    },

    loadThreads: async () => {
      try {
        const sidecar = api()
        if (!sidecar) return

        const res = await sidecar.request<{ success: boolean; threads?: ConversationThread[] }>(
          'GET',
          '/api/v1/conversations',
        )

        if (res.status === 200 && res.data?.threads) {
          const threads = res.data.threads
          set({ threads })

          // If no active thread, pick the first one or create one
          if (!get().activeThreadId && threads.length > 0) {
            await get().selectThread(threads[0].thread_id)
          } else if (threads.length === 0) {
            await get().createThread('New Conversation')
          }
        }
      } catch (e) {
        console.warn('Failed to load conversation threads:', e)
      }
    },

    selectThread: async (threadId: string) => {
      set({ activeThreadId: threadId, loading: true, error: null })
      try {
        const sidecar = api()
        if (!sidecar) return

        const res = await sidecar.request<{
          success: boolean
          messages?: Array<{
            type?: string
            role?: string
            content?: string
            data?: { content?: string; additional_kwargs?: { timestamp?: string } }
            timestamp?: string
          }>
        }>('GET', `/api/v1/conversations/${encodeURIComponent(threadId)}`)

        if (res.status === 200 && res.data?.messages) {
          const rawMsgs = res.data.messages
          const formatted: ChatMessage[] = rawMsgs.map((m, idx) => {
            const role = m.type === 'human' || m.role === 'user' ? 'user' : 'assistant'
            const content =
              typeof m.data?.content === 'string'
                ? m.data.content
                : typeof m.content === 'string'
                  ? m.content
                  : ''
            const timestamp = m.data?.additional_kwargs?.timestamp || m.timestamp || new Date().toISOString()
            return {
              id: `${threadId}-${idx}-${Date.now()}`,
              role,
              content,
              timestamp,
            }
          })
          set({ messages: formatted, loading: false })
        } else {
          set({ messages: [], loading: false })
        }
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load conversation history',
        })
      }
    },

    createThread: async (title?: string) => {
      try {
        const sidecar = api()
        if (!sidecar) return null

        const res = await sidecar.request<{
          success: boolean
          data?: { thread_id: string; title: string; created_at: string; updated_at: string }
        }>('POST', '/api/v1/conversations', { title: title || 'New Conversation' })

        if (res.status === 201 && res.data?.data) {
          const newThread: ConversationThread = {
            thread_id: res.data.data.thread_id,
            title: res.data.data.title || title || 'New Conversation',
            created_at: res.data.data.created_at,
            updated_at: res.data.data.updated_at,
            message_count: 0,
          }
          set((s) => ({
            threads: [newThread, ...s.threads],
            activeThreadId: newThread.thread_id,
            messages: [],
            error: null,
          }))
          return newThread.thread_id
        }
        return null
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Failed to create conversation' })
        return null
      }
    },

    deleteThread: async (threadId: string) => {
      try {
        const sidecar = api()
        if (!sidecar) return

        await sidecar.request('DELETE', `/api/v1/conversations/${encodeURIComponent(threadId)}`)

        const remaining = get().threads.filter((t) => t.thread_id !== threadId)
        set({ threads: remaining })

        if (get().activeThreadId === threadId) {
          if (remaining.length > 0) {
            await get().selectThread(remaining[0].thread_id)
          } else {
            await get().createThread('New Conversation')
          }
        }
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Failed to delete thread' })
      }
    },

    sendMessage: async (text: string) => {
      const clean = text.trim()
      if (!clean) return

      let threadId = get().activeThreadId
      if (!threadId) {
        threadId = await get().createThread(clean.slice(0, 30))
        if (!threadId) return
      }

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: clean,
        timestamp: new Date().toISOString(),
      }

      set((s) => ({
        messages: [...s.messages, userMsg],
        sending: true,
        error: null,
      }))

      try {
        const sidecar = api()
        if (!sidecar) throw new Error('Sidecar client unavailable')

        const res = await sidecar.request<{
          success?: boolean
          response?: string
          data?: { retreived_content?: string[] }
          detail?: string
          message?: string
        }>('POST', `/api/v1/conversations/${encodeURIComponent(threadId)}/messages`, {
          message: clean,
          stream: false,
        })

        if (res.status === 200 && res.data?.response) {
          const assistantMsg: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: res.data.response,
            timestamp: new Date().toISOString(),
            sources: res.data.data?.retreived_content || [],
          }

          // Update thread title if it's default
          const curThread = get().threads.find((t) => t.thread_id === threadId)
          if (curThread && (curThread.title === 'New Conversation' || !curThread.title)) {
            const newTitle = clean.slice(0, 35) + (clean.length > 35 ? '…' : '')
            set((s) => ({
              threads: s.threads.map((t) => (t.thread_id === threadId ? { ...t, title: newTitle } : t)),
            }))
          }

          set((s) => ({
            messages: [...s.messages, assistantMsg],
            sending: false,
          }))
        } else {
          const errMsg = res.data?.detail || res.data?.message || `AI service returned status ${res.status}`
          set((s) => ({
            sending: false,
            error: errMsg,
            messages: [
              ...s.messages,
              {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `⚠️ Error from AI assistant: ${errMsg}`,
                timestamp: new Date().toISOString(),
              },
            ],
          }))
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown communication error with AI engine'
        set((s) => ({
          sending: false,
          error: errMsg,
          messages: [
            ...s.messages,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ Communication error: ${errMsg}. Please ensure the AI engine is running.`,
              timestamp: new Date().toISOString(),
            },
          ],
        }))
      }
    },
  }
})
