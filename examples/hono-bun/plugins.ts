import type { BunPlugin } from 'bun'
import inlineSourcePlugin from '../../dist/bun.mjs'
import tailwindPlugin from 'bun-plugin-tailwind'

/**
 * Plugins for development/runtime mode
 * Includes unplugin-inline-source and bun-plugin-tailwind
 */
export const runtimePlugins: BunPlugin[] = [
  inlineSourcePlugin(),
  tailwindPlugin,
]

/**
 * Plugins for build mode
 * Includes both unplugin-inline-source and bun-plugin-tailwind
 */
export const buildPlugins: BunPlugin[] = [
  inlineSourcePlugin(),
  tailwindPlugin,
]

/**
 * @deprecated Use runtimePlugins or buildPlugins instead
 */
export const plugins = runtimePlugins
