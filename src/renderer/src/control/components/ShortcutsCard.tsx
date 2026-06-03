// ShortcutsCard (§7.6 #6 / §7.7): read-only list of global hotkeys. Editing is a
// Phase 1.1 item (§16), so we render the accelerators from settingsStore.hotkeys
// (which defaults to the §7.7 table) as static key caps.

import { Card } from './Primitives'

// Action key → human label. Order/labels match the §7.7 default table.
const ACTION_LABELS: { key: string; label: string }[] = [
  { key: 'startStop', label: 'Start / Stop' },
  { key: 'toggleOverlay', label: 'Show / Hide overlay' },
  { key: 'toggleClickThrough', label: 'Toggle click-through lock' },
  { key: 'switchMode', label: 'Switch overlay mode' },
]

export function ShortcutsCard({
  hotkeys,
}: {
  hotkeys: Record<string, string>
}): JSX.Element {
  return (
    <Card title="Shortcuts" subtitle="Global hotkeys (editing coming later)">
      <ul className="flex flex-col gap-2">
        {ACTION_LABELS.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-text">{label}</span>
            <KeyCaps accel={hotkeys[key] ?? '—'} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

// Renders an accelerator string ('Ctrl+Alt+S') as individual key caps.
function KeyCaps({ accel }: { accel: string }): JSX.Element {
  const keys = accel.split('+')
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span
          key={`${k}-${i}`}
          className="rounded-[6px] border border-border bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 text-[10px] font-medium text-muted"
        >
          {k}
        </span>
      ))}
    </span>
  )
}
