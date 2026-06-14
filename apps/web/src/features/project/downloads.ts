import { projectSchema, type Project } from '@xiaohua/contracts'

export function serializeProject(project: Project) {
  return JSON.stringify(projectSchema.parse(project), null, 2)
}

export function parseProject(content: string) {
  return projectSchema.parse(JSON.parse(content))
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadProject(project: Project) {
  downloadBlob(
    new Blob([serializeProject(project)], { type: 'application/json' }),
    `${project.title}.xiaohua.json`,
  )
}
