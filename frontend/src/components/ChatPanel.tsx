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

// Every symbol name, file path, and file basename becomes a ride:
// longest keys first so `src/api/users.ts` wins over `users`.
export function mentionTargets(nodes: GraphNode[]): MentionTarget[] {
  const map = new Map<string, string>()
  for (const node of nodes) {
    if (node.name && !map.has(node.name)) map.set(node.name, node.id)
    if (node.path && !map.has(node.path)) map.set(node.path, node.id)
    const base = node.path.split('/').pop()
    if (base && !map.has(base)) map.set(base, node.id)
  }
  return [...map.entries()]
    .map(([key, id]) => ({ key, id }))
    .sort((a, b) => b.key.length - a.key.length)
}

// Path-like tokens in prose: `src/App.tsx`, `src/a/b/:2-126`, `dir/`.
const PATH_TOKEN_RE =
  /([A-Za-z0-9_.$~][A-Za-z0-9_.$~/-]*\/[A-Za-z0-9_.$~/-]+(?::\d+(?:-\d+)?)?\/?)/g

// Resolve a prose path to a node: exact path first, then any node whose
// path ends with it (repo prefixes differ), then the shallowest file
// under it when it names a directory.
export function resolvePathToken(
  token: string,
  nodes: GraphNode[],
): GraphNode | undefined {
  const clean = token
    .replace(/:\d+(?:-\d+)?\/?$/, '')
    .replace(/[.,;)\]]+$/, '')
    .replace(/\/+$/, '')
  if (!clean) return undefined
  const exact = nodes.find((n) => n.path === clean)
  if (exact) return exact
  const suffixed = nodes.filter(
    (n) => n.path === clean || n.path.endsWith(`/${clean}`),
  )
  if (suffixed.length)
    return suffixed.sort((a, b) => a.path.length - b.path.length)[0]
  const under = nodes.filter(
    (n) =>
      n.type === 'file' &&
      (n.path.startsWith(`${clean}/`) || n.path.includes(`/${clean}/`)),
  )
  if (under.length)
    return under.sort((a, b) => a.path.length - b.path.length)[0]
  return undefined
}

function renderMentionedText(
  text: ReactNode,
  targets: MentionTarget[],
  nodes: GraphNode[],
  onNavigate?: (id: string) => void,
): ReactNode {
  if (Array.isArray(text)) {
    return text.map((child, index) => (
      <Fragment key={index}>
        {renderMentionedText(child, targets, nodes, onNavigate)}
      </Fragment>
    ))
  }
  if (typeof text !== 'string') return text
  // Phase 1: exact known names/paths/basename.
  const keyed = new Map(targets.map((t) => [t.key, t.id]))
  const exactParts =
    targets.length > 0
      ? text.split(
          new RegExp(
            `(${targets.map((t) => escapeRegExp(t.key)).join('|')})`,
            'g',
          ),
        )
      : [text]
  return exactParts.map((part, index) => {
    const id = keyed.get(part)
    if (id) {
      return (
        <button
          type="button"
          className="node-mention"
          key={`e-${part}-${index}`}
          title={`Go to ${part}`}
          onClick={() => onNavigate?.(id)}
        >
          {part}
        </button>
      )
    }
    // Phase 2: path-like tokens resolved by suffix/directory.
    return part.split(PATH_TOKEN_RE).map((chunk, j) => {
      if (!chunk) return null
      if (j % 2 === 0) return <Fragment key={`t-${j}`}>{chunk}</Fragment>
      const node = resolvePathToken(chunk, nodes)
      return node ? (
        <button
          type="button"
          className="node-mention"
          key={`p-${chunk}-${j}`}
          title={`Go to ${node.path}`}
          onClick={() => onNavigate?.(node.id)}
        >
          {chunk}
        </button>
      ) : (
        <Fragment key={`p-${j}`}>{chunk}</Fragment>
      )
    })
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
    renderMentionedText(children, targets, nodes, onNavigate)

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
                renderMentionedText(message.text, targets, nodes, onNavigate)
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
