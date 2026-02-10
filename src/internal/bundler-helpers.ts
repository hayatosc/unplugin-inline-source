/**
 * Shared bundler helpers to reduce code duplication across bundler-specific implementations
 */

import { readFile } from 'node:fs/promises'
import { transformHtml, type TransformOptions, type InlineEntry } from '../core'

/**
 * Asset resolver callback - returns content for a given asset name
 */
export type AssetResolver = (assetName: string) => string | null | Promise<string | null>

/**
 * Generic HTML inlining helper that works with any bundler's asset structure
 */
export async function inlineHtmlAssets(
  htmlAssets: Array<{ name: string; content: string }>,
  assetResolver: AssetResolver,
  options: TransformOptions | undefined,
): Promise<Array<{ name: string; content: string }>> {
  const results: Array<{ name: string; content: string }> = []

  for (const asset of htmlAssets) {
    if (!asset.name.endsWith('.html')) continue

    const transformed = await transformHtml(asset.content, async (src) => {
      const normalized = src.replace(/^\.?\//, '')
      return await assetResolver(normalized)
    }, options)

    results.push({ name: asset.name, content: transformed })
  }

  return results
}

/**
 * Build content for a marker using a provided build function
 */
export async function buildInlineContent(
  marker: string,
  entry: InlineEntry,
  buildFn: (filePath: string, type: 'js' | 'css') => Promise<string | null>,
  pluginName: string,
): Promise<string | null> {
  try {
    return await buildFn(entry.filePath, entry.type)
  } catch (e) {
    console.warn(`[${pluginName}] Failed to build ${entry.filePath}:`, e)
    return null
  }
}

/**
 * Replace markers in text content
 */
export function replaceMarkerInText(text: string, marker: string, content: string): string {
  return text.replace(
    new RegExp(`"${marker}"`, 'g'),
    JSON.stringify(content),
  )
}

/**
 * Webpack/Rspack child compiler types
 */
export type WebpackLikeAssetSource = { source: () => string | Buffer }
export type WebpackLikeAssets = Record<string, WebpackLikeAssetSource>

export type WebpackLikeCompilation = {
  hooks: {
    processAssets: {
      tapPromise: (
        options: { name: string; stage: number },
        callback: (assets: WebpackLikeAssets) => Promise<void>,
      ) => void
    }
  }
  createChildCompiler: (
    name: string,
    options: { filename: string },
    plugins: unknown[],
  ) => {
    compile: (
      callback: (
        err: unknown,
        childCompilation: { assets: WebpackLikeAssets; errors: unknown[] },
      ) => void,
    ) => void
  }
  updateAsset: (name: string, source: unknown) => void
  constructor: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }
}

export type WebpackLikeCompiler = {
  hooks: {
    compilation: {
      tap: (name: string, callback: (compilation: WebpackLikeCompilation) => void) => void
    }
  }
  webpack?: {
    Compilation?: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }
    sources?: { RawSource: new (code: string) => unknown }
    EntryPlugin?: new (...args: unknown[]) => { apply: (compiler: unknown) => void }
  }
  context?: string
}

/**
 * Unified webpack/rspack handler options
 */
export interface WebpackLikeHandlerOptions {
  pluginName: string
  inlineRegistry: Map<string, InlineEntry>
  transformOptions: TransformOptions | undefined
  fallbackToRawFile?: boolean
}

/**
 * Build content using webpack/rspack child compiler
 */
async function buildWithChildCompiler(
  marker: string,
  entry: InlineEntry,
  compilation: WebpackLikeCompilation,
  compiler: WebpackLikeCompiler,
  pluginName: string,
): Promise<string | null> {
  const childCompiler = compilation.createChildCompiler(
    `${pluginName}:${marker}`,
    { filename: `__inline_build_${marker}.js` },
    [],
  )

  // Get EntryPlugin - try from compiler.webpack first, then fall back to require
  const EntryPlugin = compiler.webpack?.EntryPlugin ?? (() => {
    try {
      return require('webpack').EntryPlugin
    } catch {
      return null
    }
  })()

  if (!EntryPlugin) {
    return null
  }

  new EntryPlugin(compiler.context, entry.filePath, { name: marker }).apply(childCompiler)

  const childAssets = await new Promise<WebpackLikeAssets>((resolve, reject) => {
    childCompiler.compile((err, childCompilation) => {
      if (err) return reject(err)
      if (childCompilation.errors.length > 0) return reject(childCompilation.errors[0])
      resolve(childCompilation.assets)
    })
  })

  // Extract content from child assets
  for (const childSource of Object.values(childAssets)) {
    if (!childSource || typeof childSource !== 'object') continue
    if (!('source' in childSource)) continue
    const maybeSource = childSource.source
    if (typeof maybeSource !== 'function') continue
    const sourceValue = maybeSource()
    return String(sourceValue)
  }

  return null
}

/**
 * Unified handler for webpack/rspack compilation
 */
export function createWebpackLikeHandler(
  compiler: unknown,
  options: WebpackLikeHandlerOptions,
): void {
  if (typeof compiler !== 'object' || compiler == null) return
  if (!('hooks' in compiler)) return

  const webpackCompiler = compiler as WebpackLikeCompiler
  if (!webpackCompiler.hooks?.compilation?.tap) return

  webpackCompiler.hooks.compilation.tap(options.pluginName, (compilation) => {
    compilation.hooks.processAssets.tapPromise(
      {
        name: options.pluginName,
        stage:
          (webpackCompiler.webpack?.Compilation ?? compilation.constructor)
            .PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
      },
      async (assets) => {
        // Build and replace inline entries
        for (const [marker, entry] of options.inlineRegistry) {
          let content: string | null = null

          try {
            content = await buildWithChildCompiler(
              marker,
              entry,
              compilation,
              webpackCompiler,
              options.pluginName,
            )
          } catch (e) {
            if (options.fallbackToRawFile) {
              try {
                content = await readFile(entry.filePath, 'utf-8')
              } catch {
                /* ignore */
              }
            }
          }

          if (content == null) continue

          // Replace markers in all JS assets
          const RawSource = webpackCompiler.webpack?.sources?.RawSource
          if (!RawSource) continue

          for (const [name, source] of Object.entries(assets)) {
            if (!name.endsWith('.js')) continue
            const text = source.source().toString()
            if (text.includes(marker)) {
              const replaced = replaceMarkerInText(text, marker, content)
              compilation.updateAsset(name, new RawSource(replaced))
            }
          }
        }

        // HTML inlining
        const htmlAssets: Array<{ name: string; content: string }> = []
        for (const [fileName, source] of Object.entries(assets)) {
          if (fileName.endsWith('.html')) {
            htmlAssets.push({
              name: fileName,
              content: source.source().toString(),
            })
          }
        }

        const transformed = await inlineHtmlAssets(
          htmlAssets,
          (normalized) => {
            for (const [name, assetSource] of Object.entries(assets)) {
              if (name === normalized || name.endsWith(normalized)) {
                return assetSource.source().toString()
              }
            }
            return null
          },
          options.transformOptions,
        )

        // Update HTML assets
        const RawSource = webpackCompiler.webpack?.sources?.RawSource
        if (RawSource) {
          for (const { name, content } of transformed) {
            compilation.updateAsset(name, new RawSource(content))
          }
        }
      },
    )
  })
}
