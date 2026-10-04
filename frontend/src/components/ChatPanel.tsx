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
  onAsk: (question: string) => void
}

function renderMentionedText(text: ReactNode, names: string[]): ReactNode {
  if (!names.length) return text
  if (Array.isArray(text)) {
    return text.map((child, index) => (
      <Fragment key={index}>{renderMentionedText(child, names)}</Fragment>
    ))
  }
  if (typeof text !== 'string') return text
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

function MarkdownMessage({ text, nodes }: { text: string; nodes: GraphNode[] }) {
  const names = useMemo(
    () => nodes.map((node) => node.name).filter(Boolean),
    [nodes],
  )
  const mention = (children: ReactNode) => renderMentionedText(children, names)

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
}: ChatPanelProps) {
  const [question, setQuestion] = useState('')

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
                <MarkdownMessage text={message.text} nodes={nodes} />
              ) : (
                renderMentionedText(
                  message.text,
                  nodes.map((node) => node.name).filter(Boolean),
                )
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
