// LanguageCard (§7.6 #2): Target = Vietnamese (locked in Phase 1). Source = Auto
// (Soniox language ID) with optional hint chips that bias detection — sent as
// `sourceHints` on session start (§4.4, §16 open item).

import { Card, Row } from './Primitives'

// A small, curated set of common source languages to hint detection. These are
// optional; Auto/language-ID already covers the default path.
const HINT_OPTIONS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
]

export function LanguageCard({
  hints,
  onToggleHint,
  disabled,
}: {
  hints: string[]
  onToggleHint: (code: string) => void
  disabled?: boolean // lock while a session is running
}): JSX.Element {
  return (
    <Card title="Language">
      <Row label="Target" hint="Phase 1 is Vietnamese only">
        <span className="flex items-center gap-1.5 rounded-10 border border-border px-2.5 py-1 text-[12px] text-text">
          🇻🇳 Vietnamese
          {/* Lock glyph signals the locked-target constraint. */}
          <span className="text-muted" aria-label="locked">
            🔒
          </span>
        </span>
      </Row>

      <Row label="Source" hint="Auto-detected (language ID)">
        <span className="rounded-10 border border-border px-2.5 py-1 text-[12px] text-muted">
          Auto
        </span>
      </Row>

      {/* Optional hint chips — multi-select bias for detection. */}
      <div>
        <div className="mb-1.5 text-[11px] text-muted">Detection hints (optional)</div>
        <div className="flex flex-wrap gap-1.5">
          {HINT_OPTIONS.map((opt) => {
            const on = hints.includes(opt.code)
            return (
              <button
                key={opt.code}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggleHint(opt.code)}
                className={[
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-120',
                  on ? 'border-accent bg-[rgba(99,102,241,0.12)] text-text' : 'border-border text-muted',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-text',
                ].join(' ')}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
