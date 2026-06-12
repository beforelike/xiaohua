import { createApp } from './app'
import { getConfig } from './config'

const config = getConfig()
const app = createApp(config)

app.listen(config.PORT, config.HOST, () => {
  console.log(`笑画 API 已启动：http://${config.HOST}:${String(config.PORT)}`)
})
