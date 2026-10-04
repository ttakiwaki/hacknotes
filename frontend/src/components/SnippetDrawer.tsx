import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'
import type { GraphNode } from '../types/contracts'
import { useGraphStore } from '../store/useGraphStore'
import type { ThemeName } from '../theme'

interface SnippetDrawerProps {
  node?: GraphNode
  code?: string
  nodes: GraphNode[]
  onNavigate: (id: string) => void
}

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'tsx') return 'tsx'
  if (extension === 'ts') return 'typescript'
  if (extension === 'js' || extension === 'jsx') return 'javascript'
  if (extension === 'py') return 'python'
  if (extension === 'css') return 'css'
  return 'text'
}

// Shiki themes bundled with the installed version (verified in
// node_modules/@shikijs/themes). One per app theme so code matches the UI.
function shikiTheme(theme: ThemeName): string {
  switch (theme) {
    case 'dark':
      return 'github-dark'
    case 'tokyo-night':
      return 'tokyo-night'
    case 'catppuccin':
      return 'catppuccin-mocha'
    case 'gruvbox':
      return 'gruvbox-dark-medium'
    default:
      return 'github-light'
  }
}

export function SnippetDrawer({
  node,
  code,
  nodes,
  onNavigate,
}: SnippetDrawerProps) {
  const [highlightedCode, setHighlightedCode] = useState('')
  const theme = useGraphStore((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    if (!node || !code) {
      return
    }
    setHighlightedCode('')
    void codeToHtml(code, {
      lang: languageForPath(node.path),
      theme: shikiTheme(theme),
    }).then((html) => {
      if (!cancelled) setHighlightedCode(html)
    })
    return () => {
      cancelled = true
    }
  }, [code, node, theme])

  if (!node) {
    return (
      <p className="empty-state">
        Choose a graph node to see its source and dependents.
      </p>
    )
  }

  // The path rides to the file node so a symbol's location is one click.
  const fileNode =
    node.type === 'file'
      ? node
      : nodes.find((n) => n.type === 'file' && n.path === node.path)

  return (
    <section className="snippet-drawer" aria-label={`Source for ${node.name}`}>
      <div className="snippet-meta">
        <strong>{node.name}</strong>
        {fileNode ? (
          <button
            type="button"
            className="node-mention"
            title={`Go to ${fileNode.path}`}
            onClick={() => onNavigate(fileNode.id)}
          >
            {node.path}:{node.startLine}-{node.endLine}
          </button>
        ) : (
          <span>
            {node.path}:{node.startLine}-{node.endLine}
          </span>
        )}
      </div>
      {code ? (
        <div
          className="snippet-highlight"
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      ) : (
        <pre className="snippet">
          <code>// Waiting for source from the server...</code>
        </pre>
      )}
    </section>
  )
}
