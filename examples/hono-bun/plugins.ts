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
 * Note: unplugin-inline-source has compatibility issues with Bun.build()
 * so we only include bun-plugin-tailwind for now
 */
export const buildPlugins: BunPlugin[] = [
  tailwindPlugin,
]

/**
 * @deprecated Use runtimePlugins or buildPlugins instead
 */
export const plugins = runtimePlugins
