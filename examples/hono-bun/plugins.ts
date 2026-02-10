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
 * Note: unplugin-inline-source cannot be used with Bun.build() because it
 * recursively calls Bun.build() in its load hook (see inline-builders.ts:75),
 * causing infinite loops. It only works with runtime plugin registration via plugin().
 */
export const buildPlugins: BunPlugin[] = [
  tailwindPlugin,
]

/**
 * @deprecated Use runtimePlugins or buildPlugins instead
 */
export const plugins = runtimePlugins
