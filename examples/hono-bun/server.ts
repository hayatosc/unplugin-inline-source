import { plugin } from 'bun'
import inlineSourcePlugin from '../../dist/bun.mjs'
import tailwindPlugin from 'bun-plugin-tailwind'

// Register plugins
plugin(inlineSourcePlugin())
plugin(tailwindPlugin)

// Import and start server
const app = await import('./src/index.tsx')
export default app.default
