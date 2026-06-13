import { readFile } from 'node:fs/promises'
import { expect, test, type Download } from '@playwright/test'

test('completes the drawing, command, delete, and save workflow', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '草地' }).click()
  await toolbox.getByRole('button', { name: '树' }).click()
  await toolbox.getByRole('button', { name: '太阳' }).click()

  await expect(page.getByText('3 个图层')).toBeVisible()
  const layerPanel = page.getByLabel('图层面板')
  await expect(layerPanel.getByRole('button', { name: /草地/ })).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /树/ })).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /太阳/ })).toBeVisible()

  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  await commandInput.fill('把太阳变小一点并移到右上角')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已更新太阳')).toBeVisible()

  await commandInput.fill('删除树')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('2 个图层')).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /树/ })).not.toBeVisible()

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('作品 PNG 和项目文件已导出')).toBeVisible()
  await expect.poll(() => downloads.length).toBe(2)

  const filenames = downloads.map((download) => download.suggestedFilename())
  expect(filenames).toContain('未命名作品.xiaohua.json')
  expect(filenames).toContain('未命名作品.png')

  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  expect(projectPath).toBeTruthy()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{ name: string }>
  }
  expect(project.layers.map((layer) => layer.name)).toEqual(['草地', '太阳'])
})

test('regenerates an existing object without creating another layer', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '树' }).click()

  const layerPanel = page.getByLabel('图层面板')
  const treeLayer = layerPanel.locator('[data-layer-id]')
  const originalLayerId = await treeLayer.getAttribute('data-layer-id')

  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  await commandInput.fill('把树画成一棵秋天的树')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已重新生成树')).toBeVisible()
  await expect(page.getByText('1 个图层')).toBeVisible()

  await expect(layerPanel.getByRole('button', { name: /树/ })).toHaveCount(1)
  await expect(treeLayer).toHaveAttribute('data-layer-id', originalLayerId!)
})
