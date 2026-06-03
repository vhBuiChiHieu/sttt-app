// SourceCard (§7.6 #1): capture-mode picker. Mode 1 (System audio) is the only
// active option in Phase 1; Mode 2 (Per-app) is shown disabled as "Coming soon"
// with an explanatory tooltip (§2).

import { Card } from './Primitives'

export function SourceCard({
  mode,
  onSelect,
  disabled,
}: {
  mode: 1 | 2
  onSelect: (mode: 1) => void // only mode 1 is selectable in Phase 1
  disabled?: boolean // lock selection while a session is running
}): JSX.Element {
  return (
    <Card title="Source" subtitle="Where the audio comes from">
      <ModeRow
        active={mode === 1}
        disabled={disabled}
        title="System audio"
        desc="Capture everything you hear (Windows loopback)"
        onClick={() => onSelect(1)}
      />
      <ModeRow
        active={false}
        disabled
        comingSoon
        title="Per-app capture"
        desc="Capture one chosen app — needs a native helper"
        tooltip="Coming soon — Phase 2 (native per-app loopback)"
      />
    </Card>
  )
}

function ModeRow({
  active,
  disabled,
  comingSoon,
  title,
  desc,
  tooltip,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  comingSoon?: boolean
  title: string
  desc: string
  tooltip?: string
  onClick?: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      className={[
        'group flex items-center gap-3 rounded-10 border px-3 py-2.5 text-left transition-colors duration-120',
        active ? 'border-accent bg-[rgba(99,102,241,0.10)]' : 'border-border',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-[rgba(255,255,255,0.04)]',
      ].join(' ')}
    >
      {/* Radio dot */}
      <span
        className={[
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          active ? 'border-accent' : 'border-muted',
        ].join(' ')}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13px] text-text">{title}</span>
          {comingSoon ? (
            <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted">
              Coming soon
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">{desc}</span>
      </span>
    </button>
  )
}
