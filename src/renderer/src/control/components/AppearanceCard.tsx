// AppearanceCard (§7.6 #5): show-source toggle and the reduced-motion override
// (§7.1/§7.8). These persist via settingsStore. The Theme (dark/auto) control was
// removed (UI-UX-REVIEW #6) — Phase 1 is dark-only with no light palette, so the
// setting did nothing; Settings.theme is kept for persistence but no longer exposed here.

import { Card, Row, Toggle } from './Primitives'

export function AppearanceCard({
  showSource,
  reducedMotion,
  onShowSource,
  onReducedMotion,
}: {
  showSource: boolean
  reducedMotion: boolean
  onShowSource: (value: boolean) => void
  onReducedMotion: (value: boolean) => void
}): JSX.Element {
  return (
    <Card title="Appearance">
      <Row label="Show source text" hint="Display the original language lane">
        <Toggle label="Show source text" checked={showSource} onChange={onShowSource} />
      </Row>

      <Row label="Reduced motion" hint="Disable per-token animations">
        <Toggle label="Reduced motion" checked={reducedMotion} onChange={onReducedMotion} />
      </Row>
    </Card>
  )
}
