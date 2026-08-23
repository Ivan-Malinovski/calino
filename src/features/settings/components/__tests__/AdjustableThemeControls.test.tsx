import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdjustableThemeProfile } from '@/types'
import { AdjustableThemeControls } from '../AdjustableThemeControls'

const PROFILE: AdjustableThemeProfile = {
  canvas: '#f7f4ee',
  panel: '#fffdfa',
  accent: '#9a6b43',
  accentContrast: '#ffffff',
  text: '#2c2823',
  mutedText: '#70695f',
  border: '#e4ded4',
  fontFamily: 'system',
  cornerRadius: 10,
  density: 100,
  shadowStrength: 70,
  eventTint: 10,
}

describe('AdjustableThemeControls', () => {
  it('updates color and slider controls through the profile callback', () => {
    const onChange = vi.fn()
    render(
      <AdjustableThemeControls
        mode="light"
        profile={PROFILE}
        onChange={onChange}
        onReset={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#ff4060' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Corner radius' }), {
      target: { value: '18' },
    })
    fireEvent.change(screen.getByLabelText('Theme font'), { target: { value: 'mono' } })

    expect(onChange).toHaveBeenNthCalledWith(1, { ...PROFILE, accent: '#ff4060' })
    expect(onChange).toHaveBeenNthCalledWith(2, { ...PROFILE, cornerRadius: 18 })
    expect(onChange).toHaveBeenNthCalledWith(3, { ...PROFILE, fontFamily: 'mono' })
  })

  it('exposes a reset action', () => {
    const onReset = vi.fn()
    render(
      <AdjustableThemeControls mode="dark" profile={PROFILE} onChange={vi.fn()} onReset={onReset} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('keeps the quiet contrast status present for valid palettes', () => {
    render(
      <AdjustableThemeControls
        mode="light"
        profile={PROFILE}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )

    expect(screen.getByText('Contrast looks good')).toBeInTheDocument()
  })

  it('warns when selected colors fall below WCAG AA contrast', () => {
    render(
      <AdjustableThemeControls
        mode="light"
        profile={{
          ...PROFILE,
          text: '#777777',
          canvas: '#ffffff',
          accentContrast: '#ffffff',
          accent: '#ffffff',
        }}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )

    const warning = screen.getByText('Contrast needs attention').parentElement
    expect(warning).toHaveAttribute(
      'title',
      expect.stringContaining('Accent text is below WCAG AA')
    )
  })
})
