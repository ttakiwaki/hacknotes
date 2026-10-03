import { useMemo, useState } from 'react'
import type { ChatMessage } from '../store/useGraphStore'
import type { GraphNode } from '../types/contracts'

interface ChatPanelProps {
  messages: ChatMessage[]
  nodes: GraphNode[]
  isStreaming: boolean
  error?: string
  onAsk: (question: string) => void
}

function renderMentionedText(text: string, nodes: GraphNode[]) {
  const names = nodes.map((node) => node.name).filter(Boolean)
  if (!names.length) return text
  const pattern = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g')
  return text.split(pattern).map((part, index) =>
    names.includes(part) ? (
      <mark className="node-mention" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function ChatPanel({
  messages,
  nodes,
  isStreaming,
  error,
  onAsk,
}: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const mentionedText = useMemo(
    () =>
      messages.map((message) => ({
        ...message,
        rendered: renderMentionedText(message.text, nodes),
      })),
    [messages, nodes],
  )

  return (
    <div className="chat">
      <p className="eyebrow">AI DEBUGGER</p>
      <div className="messages" aria-live="polite">
        {mentionedText.map((message, index) => (
          <div
            className={`message message-${message.role}`}
            key={`${message.role}-${index}`}
          >
            {message.text ? message.rendered : 'Thinking...'}
          </div>
        ))}
      </div>
      {error && <p className="error-message">{error}</p>}
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmedQuestion = question.trim()
          if (!trimmedQuestion || isStreaming) return
          onAsk(trimmedQuestion)
          setQuestion('')
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What breaks if I change this?"
          disabled={isStreaming}
          aria-label="Ask the AI debugger"
        />
        <button type="submit" disabled={isStreaming || !question.trim()}>
          {isStreaming ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  )
}
