import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../store/useGraphStore'
import type { GraphNode } from '../types/contracts'

interface ChatPanelProps {
  messages: ChatMessage[]
  nodes: GraphNode[]
  isStreaming: boolean
  error?: string
  onAsk: (question: string, nodeId?: string) => void
  onNavigate: (id: string) => void
}

export interface MentionTarget {
  key: string
  id: string
}

// Every symbol name and file path becomes a ride: longest keys first so
// `src/api/users.ts` wins over `users` inside the same text.
export function mentionTargets(nodes: GraphNode[]): MentionTarget[] {
  const map = new Map<string, string>()
  for (const node of nodes) {
    if (node.name && !map.has(node.name)) map.set(node.name, node.id)
    if (node.path && !map.has(node.path)) map.set(node.path, node.id)
  }
  return [...map.entries()]
    .map(([key, id]) => ({ key, id }))
    .sort((a, b) => b.key.length - a.key.length)
}

function renderMentionedText(
  text: ReactNode,
  targets: MentionTarget[],
  onNavigate?: (id: string) => void,
): ReactNode {
  if (!targets.length) return text
  if (Array.isArray(text)) {
    return text.map((child, index) => (
      <Fragment key={index}>
        {renderMentionedText(child, targets, onNavigate)}
      </Fragment>
    ))
  }
  if (typeof text !== 'string') return text
  const pattern = new RegExp(
    `(${targets.map((t) => escapeRegExp(t.key)).join('|')})`,
    'g',
  )
  const byKey = new Map(targets.map((t) => [t.key, t.id]))
  return text.split(pattern).map((part, index) => {
    const id = byKey.get(part)
    return id ? (
      <button
        type="button"
        className="node-mention"
        key={`${part}-${index}`}
        title={`Go to ${part}`}
        onClick={() => onNavigate?.(id)}
      >
        {part}
      </button>
    ) : (
      part
    )
  })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function MarkdownMessage({
  text,
  nodes,
  onNavigate,
}: {
  text: string
  nodes: GraphNode[]
  onNavigate?: (id: string) => void
}) {
  const targets = useMemo(() => mentionTargets(nodes), [nodes])
  const mention = (children: ReactNode) =>
    renderMentionedText(children, targets, onNavigate)

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p>{mention(children)}</p>,
        li: ({ children }) => <li>{mention(children)}</li>,
        td: ({ children }) => <td>{mention(children)}</td>,
        th: ({ children }) => <th>{mention(children)}</th>,
        h1: ({ children }) => <h1>{mention(children)}</h1>,
        h2: ({ children }) => <h2>{mention(children)}</h2>,
        h3: ({ children }) => <h3>{mention(children)}</h3>,
        h4: ({ children }) => <h4>{mention(children)}</h4>,
        strong: ({ children }) => <strong>{mention(children)}</strong>,
        em: ({ children }) => <em>{mention(children)}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}

export function ChatPanel({
  messages,
  nodes,
  isStreaming,
  error,
  onAsk,
  onNavigate,
}: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const targets = useMemo(() => mentionTargets(nodes), [nodes])

  return (
    <div className="chat">
      <p className="eyebrow">AI DEBUGGER</p>
      <div className="messages" aria-live="polite">
        {messages.map((message, index) => (
          <div
            className={`message message-${message.role}`}
            key={`${message.role}-${index}`}
          >
            {message.text ? (
              message.role === 'assistant' ? (
                <MarkdownMessage
                  text={message.text}
                  nodes={nodes}
                  onNavigate={onNavigate}
                />
              ) : (
                renderMentionedText(message.text, targets, onNavigate)
              )
            ) : (
              'Thinking...'
            )}
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
