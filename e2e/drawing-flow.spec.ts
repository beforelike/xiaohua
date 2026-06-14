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

  await page.reload()
  await expect(page.getByText('0 个图层')).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles(projectPath!)
  await expect(page.getByText('项目已导入')).toBeVisible()
  await expect(page.getByText('2 个图层')).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /草地/ })).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /太阳/ })).toBeVisible()
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

test('recolors local SVG assets without regenerating the object', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '太阳' }).click()

  const layerPanel = page.getByLabel('图层面板')
  const sunLayer = layerPanel.locator('[data-layer-id]')
  const originalLayerId = await sunLayer.getAttribute('data-layer-id')

  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  await commandInput.fill('将太阳涂成红色')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已将太阳改成指定颜色')).toBeVisible()
  await expect(page.getByText('1 个图层')).toBeVisible()
  await expect(sunLayer).toHaveAttribute('data-layer-id', originalLayerId!)

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect.poll(() => downloads.length).toBe(2)

  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  expect(projectPath).toBeTruthy()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{ id: string; name: string; assetUrl?: string }>
  }
  expect(project.layers).toHaveLength(1)
  expect(project.layers[0]).toMatchObject({
    id: originalLayerId,
    name: '太阳',
  })
  expect(decodeURIComponent(project.layers[0]!.assetUrl!)).toContain(
    'fill="#dc2626"',
  )
})

test('duplicates, undoes, and redoes objects without image generation', async ({
  page,
}) => {
  let generationRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/assets/generate')) {
      generationRequests += 1
    }
  })
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '太阳' }).click()
  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  const layerPanel = page.getByLabel('图层面板')

  await commandInput.fill('复制太阳')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已复制太阳')).toBeVisible()
  await expect(page.getByText('2 个图层')).toBeVisible()
  await expect(
    layerPanel.getByRole('button', { name: /太阳 副本/ }),
  ).toBeVisible()
  expect(generationRequests).toBe(0)

  await commandInput.fill('撤销')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已撤销上一步操作')).toBeVisible()
  await expect(page.getByText('1 个图层')).toBeVisible()

  await commandInput.fill('重做')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已重做上一步操作')).toBeVisible()
  await expect(page.getByText('2 个图层')).toBeVisible()
  expect(generationRequests).toBe(0)
})

test('groups objects for coordinated movement and preserves the relation in export', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '树' }).click()
  await toolbox.getByRole('button', { name: '太阳' }).click()
  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')

  await commandInput.fill('把树和太阳组合')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(
    page.getByText(/已组合.*树.*太阳|已组合.*太阳.*树/),
  ).toBeVisible()
  await expect(page.getByLabel('作品记忆')).toContainText('属于同一组合')

  await commandInput.fill('把太阳移到右边')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已更新太阳')).toBeVisible()

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect.poll(() => downloads.length).toBe(2)
  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{ name: string; x: number; groupId?: string }>
  }
  const tree = project.layers.find((layer) => layer.name === '树')
  const sun = project.layers.find((layer) => layer.name === '太阳')
  expect(tree?.groupId).toBeTruthy()
  expect(tree?.groupId).toBe(sun?.groupId)
  expect(tree!.x).toBeGreaterThan(400)

  await commandInput.fill('取消太阳的组合')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已取消对象组合')).toBeVisible()
  await expect(page.getByLabel('作品记忆')).not.toContainText('属于同一组合')
})

test('adds a new referenced object instead of confusing it with the reference layer', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '树' }).click()

  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  await commandInput.fill('在树旁边画一只小鸟')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('新素材已经加入画布')).toBeVisible()

  const layerPanel = page.getByLabel('图层面板')
  const memoryPanel = page.getByLabel('作品记忆')
  await expect(page.getByText('2 个图层')).toBeVisible()
  await expect(layerPanel.getByRole('button', { name: /树/ })).toHaveCount(1)
  await expect(layerPanel.getByRole('button', { name: /小鸟/ })).toHaveCount(1)
  await expect(memoryPanel).toContainText('树位于')
  await expect(memoryPanel).toContainText('小鸟位于')

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect.poll(() => downloads.length).toBe(2)

  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  expect(projectPath).toBeTruthy()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{ name: string; x: number; relation?: string }>
  }
  const tree = project.layers.find((layer) => layer.name === '树')
  const bird = project.layers.find((layer) => layer.name === '小鸟')
  expect(tree).toBeTruthy()
  expect(bird).toBeTruthy()
  expect(bird!.x).toBeGreaterThan(tree!.x)
  expect(bird!.relation).toBe('right-of:树')
})

test('keeps text and attached accessories through move and export', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '树' }).click()

  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')
  await commandInput.fill('在顶部写上“今天也要开心”，用醒目的红色粗体')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已添加文字“今天也要开心”')).toBeVisible()

  await commandInput.fill('给树戴上一顶蓝色魔法帽子')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已为树添加独立配饰“蓝色魔法帽子”')).toBeVisible()

  const layerPanel = page.getByLabel('图层面板')
  const memoryPanel = page.getByLabel('作品记忆')
  await expect(layerPanel.getByRole('button', { name: /树/ })).toBeVisible()
  await expect(
    layerPanel.getByRole('button', { name: /蓝色魔法帽子/ }),
  ).toBeVisible()
  await expect(
    layerPanel.getByRole('button', { name: /今天也要开心/ }),
  ).toBeVisible()
  await expect(page.getByText('3 个图层')).toBeVisible()
  await expect(memoryPanel).toContainText('文字“今天也要开心”')
  await expect(memoryPanel).toContainText('蓝色魔法帽子附着在树上')

  await commandInput.fill('把树移到右边')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已更新树')).toBeVisible()

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('作品 PNG 和项目文件已导出')).toBeVisible()
  await expect.poll(() => downloads.length).toBe(2)

  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  expect(projectPath).toBeTruthy()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{
      id: string
      name: string
      type: string
      parentLayerId?: string
      relation?: string
      textContent?: string
      fill?: string
      fontWeight?: string
      x: number
      y: number
    }>
  }

  const tree = project.layers.find((layer) => layer.name === '树')
  const hat = project.layers.find((layer) => layer.name === '蓝色魔法帽子')
  const text = project.layers.find((layer) => layer.name === '今天也要开心')
  expect(tree).toBeTruthy()
  expect(hat).toMatchObject({
    type: 'preset',
    parentLayerId: tree!.id,
    relation: 'attached-to:树',
  })
  expect(hat!.x).toBeGreaterThan(tree!.x)
  expect(text).toMatchObject({
    type: 'text',
    textContent: '今天也要开心',
    fill: '#dc2626',
    fontWeight: 'bold',
    y: 48,
  })
})

test('persists smart text layout and deterministic layer controls', async ({
  page,
}) => {
  await page.goto('/')

  const toolbox = page.getByLabel('素材工具箱')
  await toolbox.getByRole('button', { name: '树' }).click()
  const commandInput = page.getByPlaceholder('例如：把太阳变小一点并移到右上角')

  await commandInput.fill(
    '在顶部写上“今天也要保持好奇和创造力”，用活泼的涂鸦字',
  )
  await page.getByRole('button', { name: '执行' }).click()
  await expect(
    page.getByText('已添加文字“今天也要保持好奇和创造力”'),
  ).toBeVisible()
  await expect(page.getByLabel('作品记忆')).toContainText(
    '文字“今天也要保持好奇和创造力”',
  )

  await commandInput.fill('把树设为半透明并隐藏')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(page.getByText('已更新树')).toBeVisible()
  const treeRow = page
    .getByLabel('图层面板')
    .locator('[data-layer-id]')
    .filter({ hasText: '树' })
  await expect(treeRow.getByRole('button', { name: '○' })).toBeVisible()

  await commandInput.fill('显示树')
  await page.getByRole('button', { name: '执行' }).click()
  await commandInput.fill('锁定树')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(treeRow.getByRole('button', { name: '锁' })).toBeVisible()
  await commandInput.fill('解锁树并顺时针再转一点')
  await page.getByRole('button', { name: '执行' }).click()
  await expect(treeRow.getByRole('button', { name: '开' })).toBeVisible()

  const downloads: Download[] = []
  page.on('download', (download) => downloads.push(download))
  await commandInput.fill('保存作品')
  await page.getByRole('button', { name: '执行' }).click()
  await expect.poll(() => downloads.length).toBe(2)
  const projectDownload = downloads.find((download) =>
    download.suggestedFilename().endsWith('.xiaohua.json'),
  )
  const projectPath = await projectDownload?.path()
  expect(projectPath).toBeTruthy()
  const project = JSON.parse(await readFile(projectPath!, 'utf8')) as {
    layers: Array<{
      name: string
      type: string
      width: number
      rotation: number
      opacity: number
      visible: boolean
      locked: boolean
      fontFamily?: string
    }>
  }
  const tree = project.layers.find((layer) => layer.name === '树')
  const title = project.layers.find(
    (layer) => layer.name === '今天也要保持好奇和创造力',
  )
  expect(tree).toMatchObject({
    opacity: 0.5,
    visible: true,
    locked: false,
    rotation: 15,
  })
  expect(title).toMatchObject({
    type: 'text',
    width: 820,
  })
  expect(title?.fontFamily).toContain('KaiTi')
})
