import { useEffect, useRef, useState } from 'react'
import { MarkdownMessage } from './ChatPanel'
import type { ChatMessage } from '../store/useGraphStore'
import type { GraphNode } from '../types/contracts'

interface PromptBarProps {
  nodes: GraphNode[]
  disabled: boolean
  streaming: boolean
  messages: ChatMessage[]
  onAsk: (question: string, nodeId?: string) => void
  onNavigate: (id: string) => void
}

// Score nodes against question tokens: exact name hits win, then partial
// name hits, then path hits. Sorted best-first, scoreless dropped.
export function resolveTargets(
  question: string,
  nodes: GraphNode[],
  k: number = 3,
): GraphNode[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length > 2)
  if (!tokens.length || !nodes.length) return []
  const scored: { node: GraphNode; score: number }[] = []
  for (const node of nodes) {
    const name = node.name.toLowerCase()
    const path = node.path.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (name === token) score += 5
      else if (name.includes(token)) score += 2
      else if (path.includes(token)) score += 1
    }
    if (score > 0) scored.push({ node, score })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.node)
}

export function resolveTarget(
  question: string,
  nodes: GraphNode[],
): GraphNode | undefined {
  return resolveTargets(question, nodes, 1)[0]
}

export function PromptBar({
  nodes,
  disabled,
  streaming,
  messages,
  onAsk,
  onNavigate,
}: PromptBarProps) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [asked, setAsked] = useState('')
  const [targetName, setTargetName] = useState<string | undefined>()
  const [runnersUp, setRunnersUp] = useState<GraphNode[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant')

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Cmd on macOS, Ctrl on Windows/Linux. (Some browsers reserve
      // Ctrl+K for their own search bar, where the shortcut may not win.)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const modHint =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad/i.test(`${navigator.platform} ${navigator.userAgent}`)
      ? '⌘K'
      : 'Ctrl+K'

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    // Guide first: fly to the best-matching symbol and open it, then ask.
    // The camera move is instant; the answer streams in below.
    // Runners-up stay as chips for when the guess is wrong.
    const [best, ...rest] = resolveTargets(trimmed, nodes, 3)
    if (best) {
      onNavigate(best.id)
      setTargetName(best.name)
      setRunnersUp(rest)
    } else {
      setTargetName(undefined)
      setRunnersUp([])
    }
    onAsk(trimmed, best?.id)
    setAsked(trimmed)
    setValue('')
    setOpen(true)
  }

  return (
    <div className="promptbar">
      <form
        className="promptbar-input"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.blur()
              setOpen(false)
            }
          }}
          placeholder={`Ask anything or jump to a symbol…  (${modHint})`}
          aria-label="Universal AI prompt bar"
        />
        <button type="submit" disabled={disabled || !value.trim()}>
          {disabled ? '...' : 'Ask'}
        </button>
      </form>
      {open && (streaming || lastAssistant) && (
        <div className="promptbar-answer">
          <div className="promptbar-answer-head">
            {targetName ? (
              <span className="promptbar-target">📍 {targetName}</span>
            ) : (
              <span className="promptbar-target promptbar-target-none">
                No symbol match, asking anyway
              </span>
            )}
            <button
              type="button"
              className="promptbar-close"
              onClick={() => setOpen(false)}
              aria-label="Close answer"
            >
              ×
            </button>
          </div>
          <div className="promptbar-answer-body">
            {lastAssistant?.text ? (
              <MarkdownMessage
                text={lastAssistant.text}
                nodes={nodes}
                onNavigate={onNavigate}
              />
            ) : (
              'Thinking...'
            )}
          </div>
          {runnersUp.length > 0 && (
            <div className="promptbar-chips">
              <span>Unsure? Try:</span>
              {runnersUp.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="promptbar-chip"
                  title={node.path}
                  onClick={() => {
                    onNavigate(node.id)
                    onAsk(asked, node.id)
                  }}
                >
                  {node.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
