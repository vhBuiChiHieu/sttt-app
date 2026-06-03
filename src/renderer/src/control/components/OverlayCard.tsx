// OverlayCard (§7.6 #4): live overlay appearance controls. Every change is both
// pushed to the overlay/main via window.api AND mirrored into settingsStore for
// instant UI feedback (App owns that wiring; this card is presentational).

import { Card, Row, Segmented, Slider, Stepper, Toggle } from './Primitives'

// Position presets (overlay anchor). `position` is a free string in Settings;
// we constrain the control to this preset set per §7.6.
const POSITIONS: { value: string; label: string }[] = [
  { value: 'top-center', label: 'Top' },
  { value: 'bottom-center', label: 'Bottom' },
  { value: 'bottom-left', label: 'B-Left' },
  { value: 'bottom-right', label: 'B-Right' },
]

// Font scale clamp (§7.8: 80–200%).
const FONT_MIN = 0.8
const FONT_MAX = 2.0
const FONT_STEP = 0.1

export function OverlayCard({
  overlayMode,
  position,
  opacity,
  fontScale,
  clickThroughLocked,
  onOverlayMode,
  onPosition,
  onOpacity,
  onFontScale,
  onClickThrough,
}: {
  overlayMode: 'caption' | 'panel'
  position: string
  opacity: number
  fontScale: number
  clickThroughLocked: boolean
  onOverlayMode: (mode: 'caption' | 'panel') => void
  onPosition: (pos: string) => void
  onOpacity: (value: number) => void
  onFontScale: (value: number) => void
  onClickThrough: (locked: boolean) => void
}): JSX.Element {
  // Round to avoid fp drift accumulating across stepper presses.
  const clampFont = (v: number): number =>
    Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 10) / 10

  return (
    <Card title="Overlay">
      <Row label="Style">
        <Segmented
          value={overlayMode}
          onChange={onOverlayMode}
          options={[
            { value: 'caption', label: 'Caption' },
            { value: 'panel', label: 'Panel' },
          ]}
        />
      </Row>

      <Row label="Position">
        <Segmented value={position} onChange={onPosition} options={POSITIONS} />
      </Row>

      <Row label="Opacity" hint={`${Math.round(opacity * 100)}%`}>
        <Slider
          ariaLabel="Overlay opacity"
          value={opacity}
          min={0.3}
          max={1}
          step={0.05}
          onChange={onOpacity}
        />
      </Row>

      <Row label="Font size">
        <Stepper
          display={`${Math.round(fontScale * 100)}%`}
          canDec={fontScale > FONT_MIN + 1e-6}
          canInc={fontScale < FONT_MAX - 1e-6}
          onDec={() => onFontScale(clampFont(fontScale - FONT_STEP))}
          onInc={() => onFontScale(clampFont(fontScale + FONT_STEP))}
        />
      </Row>

      <Row label="Lock click-through" hint="Mouse passes through the overlay">
        <Toggle
          label="Lock overlay click-through"
          checked={clickThroughLocked}
          onChange={onClickThrough}
        />
      </Row>
    </Card>
  )
}
