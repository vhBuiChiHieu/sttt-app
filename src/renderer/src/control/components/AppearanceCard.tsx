// AppearanceCard (§7.6 #5): theme (dark/auto), show-source toggle, and the
// reduced-motion override (§7.1/§7.8). These persist via settingsStore; theme
// also rides the overlay:appearance push (App wiring).

import { Card, Row, Segmented, Toggle } from './Primitives'

export function AppearanceCard({
  theme,
  showSource,
  reducedMotion,
  onTheme,
  onShowSource,
  onReducedMotion,
}: {
  theme: 'dark' | 'auto'
  showSource: boolean
  reducedMotion: boolean
  onTheme: (theme: 'dark' | 'auto') => void
  onShowSource: (value: boolean) => void
  onReducedMotion: (value: boolean) => void
}): JSX.Element {
  return (
    <Card title="Appearance">
      <Row label="Theme">
        <Segmented
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Auto' },
          ]}
        />
      </Row>

      <Row label="Show source text" hint="Display the original language lane">
        <Toggle label="Show source text" checked={showSource} onChange={onShowSource} />
      </Row>

      <Row label="Reduced motion" hint="Disable per-token animations">
        <Toggle label="Reduced motion" checked={reducedMotion} onChange={onReducedMotion} />
      </Row>
    </Card>
  )
}
