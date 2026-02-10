import { plugin } from 'bun'
import { runtimePlugins } from './plugins'

// Register runtime plugins (inline-source + tailwind)
for (const p of runtimePlugins) {
  plugin(p)
}

// Import and start server
const app = await import('./src/index.tsx')
export default app.default
