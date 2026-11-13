import { ChevronDown, Copy, Check, FileText, Loader2, MessageSquare, Plus, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useChat, type ChatMessage } from '@/stores/chat'
import { useSidecar } from '@/stores/sidecar'
import { toast } from '@/stores/toast'

const SUGGESTIONS = [
  'How do I tag Share Capital under Ind AS?',
  'Explain difference between instant and duration concepts',
  'What are the mandatory disclosures for AOC-4 filing?',
  'How does zero-filling work for non-applicable line items?',
]

/**
 * AiChatPanel: Left sidebar interactive chatbot connected to the in-memory
 * LangGraph checkpointer & MCA/XBRL RAG knowledge pipeline.
 */
export function AiChatPanel() {
  const {
    threads,
    activeThreadId,
    messages,
    loading,
    sending,
    error,
    init,
    selectThread,
    createThread,
    deleteThread,
    sendMessage,
    clearError,
  } = useChat()

  const sidecarStatus = useSidecar((s) => s.status)
  const [input, setInput] = useState('')
  const [showThreadPicker, setShowThreadPicker] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void init()
  }, [init])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const activeThread = threads.find((t) => t.thread_id === activeThreadId)

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim()
    if (!text || sending) return
    setInput('')
    await sendMessage(text)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const isReady = sidecarStatus.state === 'ready'

  return (
    <div className="flex h-full flex-col bg-panel text-fg select-text">
      {/* Top Header / Thread Switcher */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-panel-2 px-2.5">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setShowThreadPicker(!showThreadPicker)}
            className="flex items-center gap-1.5 max-w-full rounded px-1.5 py-1 text-left text-xs hover:bg-panel transition-colors"
            title="Switch conversation thread"
          >
            <MessageSquare size={13} className="shrink-0 text-accent" />
            <span className="truncate font-medium text-xs">
              {activeThread ? activeThread.title : 'Conversations'}
            </span>
            <ChevronDown size={11} className="shrink-0 text-muted" />
          </button>

          {/* Thread Switcher Dropdown */}
          {showThreadPicker && (
            <div className="absolute left-0 top-8 z-30 w-56 rounded-md border border-border bg-panel p-1 shadow-xl">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <span>Recent Threads</span>
                <button
                  type="button"
                  onClick={() => setShowThreadPicker(false)}
                  className="hover:text-fg"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="max-h-48 overflow-auto py-0.5">
                {threads.map((t) => (
                  <div
                    key={t.thread_id}
                    className={cn(
                      'group flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors cursor-pointer',
                      t.thread_id === activeThreadId ? 'bg-accent/15 text-accent' : 'hover:bg-panel-2 text-fg',
                    )}
                    onClick={() => {
                      void selectThread(t.thread_id)
                      setShowThreadPicker(false)
                    }}
                  >
                    <span className="truncate pr-2 font-medium">{t.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteThread(t.thread_id)
                      }}
                      className="hidden group-hover:block text-muted hover:text-err p-0.5"
                      title="Delete thread"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action icons */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            className="h-6 w-6 p-0 text-muted hover:text-fg"
            onClick={() => void createThread('New Conversation')}
            title="Start new conversation"
          >
            <Plus size={13} />
          </Button>
          {activeThreadId && (
            <Button
              variant="ghost"
              className="h-6 w-6 p-0 text-muted hover:text-err"
              onClick={() => void deleteThread(activeThreadId)}
              title="Clear current conversation"
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="flex items-center justify-between bg-err/15 px-3 py-1 text-[11px] text-err border-b border-err/20">
          <span className="truncate">{error}</span>
          <button type="button" onClick={clearError} className="hover:opacity-80">
            <X size={11} />
          </button>
        </div>
      )}

      {/* Messages Stream */}
      <div className="flex-1 overflow-auto p-3 space-y-3.5">
        {loading ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-xs">Loading conversation history...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-2 py-6">
            <div className="rounded-full bg-accent/10 p-2.5 text-accent mb-2.5">
              <Sparkles size={20} />
            </div>
            <h3 className="text-xs font-semibold text-fg">XBRL Filing AI Copilot</h3>
            <p className="mt-1 text-[11px] text-muted leading-relaxed max-w-xs">
              Ask questions regarding MCA regulations, Ind AS taxonomy, line item mapping, or mandatory disclosure rules.
            </p>

            <div className="mt-4 w-full space-y-1.5 text-left">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1">
                Suggested prompts:
              </span>
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => void handleSend(s)}
                  className="w-full rounded border border-border bg-panel-2 px-2.5 py-1.5 text-left text-xs text-muted hover:border-accent hover:text-fg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))
        )}

        {/* Sending thinking animation */}
        {sending && (
          <div className="flex items-start gap-2 text-xs">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent mt-0.5">
              <Sparkles size={11} />
            </div>
            <div className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-muted flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-accent" />
              <span className="text-[11px]">Thinking & consulting MCA knowledge base...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border bg-panel-2 p-2">
        <div className="relative flex flex-col rounded-md border border-border bg-panel focus-within:border-accent transition-colors">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isReady ? 'Ask about XBRL tagging, MCA rules, or disclosures...' : 'AI Engine starting...'}
            disabled={sending}
            className="w-full resize-none bg-transparent p-2 text-xs outline-none placeholder:text-muted/60 disabled:opacity-50 select-text"
          />
          <div className="flex items-center justify-between border-t border-border/40 px-2 py-1 text-[10px] text-muted">
            <span>Enter to send · Shift+Enter for newline</span>
            <Button
              variant="primary"
              className="h-6 px-2 text-[11px]"
              disabled={!input.trim() || sending}
              onClick={() => void handleSend()}
              title="Send message"
            >
              <Send size={11} className="mr-1" /> Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-1.5 mb-1 px-1">
        {!isUser && <Sparkles size={11} className="text-accent" />}
        <span className="text-[10px] font-semibold text-muted">
          {isUser ? 'You' : 'AI Assistant'}
        </span>
      </div>

      <div
        className={cn(
          'max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed select-text',
          isUser
            ? 'bg-accent text-accent-fg'
            : 'border border-border bg-panel-2 text-fg shadow-xs',
        )}
      >
        <MarkdownContent content={message.content} />

        {/* Retrieved RAG context sources if present */}
        {message.sources && message.sources.length > 0 && (
          <details className="mt-2.5 border-t border-border/40 pt-1.5 text-[10px]">
            <summary className="cursor-pointer text-muted hover:text-fg font-medium flex items-center gap-1 select-none">
              <FileText size={10} />
              <span>Cited MCA / Taxonomy Knowledge ({message.sources.length})</span>
            </summary>
            <div className="mt-1 space-y-1 max-h-36 overflow-auto pr-1">
              {message.sources.map((s, idx) => (
                <div
                  key={idx}
                  className="rounded bg-panel p-1.5 font-mono text-[9px] text-muted border border-border/60 select-text leading-tight"
                >
                  {s}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

/** Rich Markdown preview renderer powered by marked (GFM tables, headers, lists, code blocks) */
function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content, { gfm: true, breaks: true }) as string
    } catch {
      return content
    }
  }, [content])

  return (
    <div
      className="markdown-body select-text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
