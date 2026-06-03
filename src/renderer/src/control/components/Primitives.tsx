// Small reusable presentational primitives for the control card stack (§7.6).
// All visuals come from the §7.1 design tokens via Tailwind utility classes.

import type { ReactNode } from 'react'

// A glass-ish surface card with a title row. Radius 16 = "card" per §7.1.
export function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rounded-16 border border-border bg-surface px-4 py-3.5">
      <header className="mb-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-text">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p> : null}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

// A labelled row: label on the left, control on the right.
export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-text">{label}</div>
        {hint ? <div className="text-[11px] text-muted">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

// iOS-style toggle. Accent when on, muted track when off.
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-[22px] w-[38px] rounded-full border border-border transition-colors duration-120',
        checked ? 'bg-accent' : 'bg-[rgba(255,255,255,0.06)]',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* Knob: slides on toggle. transform-only for cheap motion. */}
      <span
        className="absolute top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full bg-white transition-transform duration-120 ease-easeOutExpo"
        style={{ transform: `translate(${checked ? 18 : 3}px, -50%)` }}
      />
    </button>
  )
}

// Segmented control — used for Caption/Panel and theme dark/auto.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className="flex rounded-10 border border-border bg-[rgba(255,255,255,0.03)] p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'rounded-[8px] px-3 py-1 text-[12px] transition-colors duration-120',
              active ? 'bg-accent text-white' : 'text-muted hover:text-text',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Range slider styled on the accent. Native input keeps a11y for free.
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
  ariaLabel: string
}): JSX.Element {
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      className="ctrl-range h-1.5 w-[140px] cursor-pointer appearance-none rounded-full"
      style={{
        // Filled portion in accent, remainder hairline — pure CSS, no JS thumb.
        background: `linear-gradient(90deg, var(--accent) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.10) ${((value - min) / (max - min)) * 100}%)`,
      }}
    />
  )
}

// −/+ stepper (font size). Buttons disabled at the clamp edges.
export function Stepper({
  onDec,
  onInc,
  display,
  canDec,
  canInc,
}: {
  onDec: () => void
  onInc: () => void
  display: string
  canDec: boolean
  canInc: boolean
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <StepBtn label="Decrease font size" disabled={!canDec} onClick={onDec}>
        −
      </StepBtn>
      <span className="min-w-[44px] text-center text-[12px] tabular-nums text-text">{display}</span>
      <StepBtn label="Increase font size" disabled={!canInc} onClick={onInc}>
        +
      </StepBtn>
    </div>
  )
}

function StepBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-10 border border-border text-[15px] leading-none text-text transition-colors duration-120',
        disabled
          ? 'cursor-not-allowed opacity-35'
          : 'cursor-pointer hover:bg-[rgba(255,255,255,0.06)]',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
