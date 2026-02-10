import type { BunPlugin } from 'bun'
import inlineSourcePlugin from '../../dist/bun.mjs'
import tailwindPlugin from 'bun-plugin-tailwind'

/**
 * Shared plugins for both development and build
 * Includes unplugin-inline-source and bun-plugin-tailwind
 */
export const plugins: BunPlugin[] = [
  inlineSourcePlugin(),
  tailwindPlugin,
]
