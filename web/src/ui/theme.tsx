// Theme switch: System / Light / Dark. The choice is stored per browser and applied as data-theme on <html>, which
// sets `color-scheme` (index.css); every colour token is light-dark(), so nothing else needs to know the theme.
// index.html applies the stored choice before the first paint, so there's no flash on load.

import { useEffect, useState, type ReactNode } from 'react'

type Theme = 'system' | 'light' | 'dark'
const KEY = 'he80-theme'

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system' // storage blocked: just follow the system
  }
}

const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
)
const OPTIONS: [Theme, string, ReactNode][] = [
  ['system', 'Match system', icon(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>)],
  ['light', 'Light', icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)],
  ['dark', 'Dark', icon(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />)],
]

export function ThemeSwitch() {
  const [theme, setTheme] = useState(stored)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    try { localStorage.setItem(KEY, theme) } catch { /* not remembered, still applied */ }
  }, [theme])

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-md border border-line p-0.5">
      {OPTIONS.map(([t, label, svg]) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} aria-label={label} title={label}
          onClick={() => setTheme(t)}
          className={`grid size-7 place-items-center rounded focus-visible:outline-2 focus-visible:outline-ink ${
            theme === t ? 'bg-ink text-plate' : 'text-mute hover:text-ink'}`}>
          {svg}
        </button>
      ))}
    </div>
  )
}
