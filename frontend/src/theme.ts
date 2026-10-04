export const THEMES = [
  'light',
  'dark',
  'tokyo-night',
  'catppuccin',
  'gruvbox',
] as const

export type ThemeName = (typeof THEMES)[number]

export const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Dark',
  'tokyo-night': 'Tokyo Night',
  catppuccin: 'Catppuccin',
  gruvbox: 'Gruvbox',
}

// Categorical graph colors per theme: node fills + edge strokes.
// Chrome (backgrounds, text, borders) lives in App.css variables.
export const GRAPH_COLORS: Record<
  ThemeName,
  { function: string; class: string; file: string; fileHtml: string; fileCss: string; calls: string; imports: string; defines: string }
> = {
  light: {
    function: '#bcb0ff',
    class: '#ffd33d',
    file: '#65d9a1',
    fileHtml: '#ffbf80',
    fileCss: '#f2a6c8',
    calls: '#ff916d',
    imports: '#78a7f5',
    defines: '#8e8e93',
  },
  dark: {
    function: '#8f81f7',
    class: '#e8b93e',
    file: '#4cc38a',
    fileHtml: '#e09543',
    fileCss: '#d97b9e',
    calls: '#ff916d',
    imports: '#7aa2f7',
    defines: '#6b6c78',
  },
  'tokyo-night': {
    function: '#7aa2f7',
    class: '#e0af68',
    file: '#9ece6a',
    fileHtml: '#ff9e64',
    fileCss: '#bb9af7',
    calls: '#ff9e64',
    imports: '#7aa2f7',
    defines: '#565a7a',
  },
  catppuccin: {
    function: '#b4befe',
    class: '#f9e2af',
    file: '#a6e3a1',
    fileHtml: '#fab387',
    fileCss: '#f5c2e7',
    calls: '#fab387',
    imports: '#89b4fa',
    defines: '#6c7086',
  },
  gruvbox: {
    function: '#d3869b',
    class: '#fabd2f',
    file: '#b8bb26',
    fileHtml: '#fe8019',
    fileCss: '#d3869b',
    calls: '#fe8019',
    imports: '#83a598',
    defines: '#7c6f64',
  },
}

const THEME_KEY = 'uxie-theme'

export function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved && (THEMES as readonly string[]).includes(saved)) {
      return saved as ThemeName
    }
  } catch {
    // private mode etc: fall through to default
  }
  return 'light'
}

// "https://github.com/owner/repo(.git)" -> "owner/repo", else trimmed input.
export function repoName(url: string): string {
  const m = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (m) return `${m[1]}/${m[2]}`
  return url.trim()
}
