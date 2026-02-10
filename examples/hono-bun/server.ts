import { plugin } from 'bun'
import inlineSourcePlugin from '../../dist/bun.mjs'

// Register plugin
plugin(inlineSourcePlugin())

// Import and start server
const app = await import('./src/index.tsx')
export default app.default
