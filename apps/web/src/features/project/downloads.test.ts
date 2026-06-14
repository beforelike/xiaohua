import { describe, expect, it } from 'vitest'
import { createProject } from './model'
import { parseProject, serializeProject } from './downloads'

describe('project downloads', () => {
  it('round-trips a versioned project', () => {
    const project = createProject('测试作品', {
      id: () => 'project-1',
      now: () => '2026-06-12T12:00:00.000Z',
    })

    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('rejects invalid project files', () => {
    expect(() => parseProject('{"schemaVersion":99}')).toThrow()
    expect(() => parseProject('not-json')).toThrow()
  })
})
