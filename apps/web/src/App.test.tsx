import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('communicates the current implementation status without claiming unfinished features', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '画布正在 准备颜料。' }),
    ).toBeInTheDocument()
    expect(screen.getByText('工程骨架已就绪')).toBeInTheDocument()
    expect(screen.getByLabelText('画布功能开发中')).toBeInTheDocument()
  })
})
