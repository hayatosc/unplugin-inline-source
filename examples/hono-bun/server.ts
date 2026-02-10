import { plugin } from 'bun'
import { plugins } from './plugins'

// Register plugins (inline-source + tailwind)
for (const p of plugins) {
  plugin(p)
}

// Import and start server
const app = await import('./src/index.tsx')
export default app.default
