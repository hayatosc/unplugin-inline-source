import { createUnplugin } from 'unplugin'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { transformHtml, transformJsx, type TransformOptions, type InlineEntry } from './core'
import { createViteHtmlHandlers } from './vite-html'
import { buildWithBun, buildWithFarm } from './internal/inline-builders'
import {
  INLINE_QUERY,
  CSS_LOADER_PREFIX,
  BUILD_PREFIX,
  resolveInlinePath,
  getInlineFileType,
  replaceInlineMarkersInBundle,
} from './internal/inline-utils'

export { transformHtml, transformJsx, type TransformOptions, type ResolveContent, type InlineEntry } from './core'

const PLUGIN_NAME = 'unplugin-inline-source'
const QUERY = INLINE_QUERY

// Bundlers that have output-phase hooks for marker replacement
const MARKER_FRAMEWORKS = new Set(['vite', 'rollup', 'rolldown', 'webpack', 'esbuild', 'rspack'])

export const unplugin = createUnplugin<TransformOptions | undefined>((options, meta) => {
  const attr = options?.attribute ?? 'inline'
  const inlineRegistry = new Map<string, InlineEntry>()
  let markerCounter = 0
  const useMarkers = MARKER_FRAMEWORKS.has(meta.framework)

  function registerMarker(filePath: string, type: 'js' | 'css'): string {
    const marker = `__INLINE_BUILD_${markerCounter++}__`
    inlineRegistry.set(marker, { filePath, type })
    return marker
  }

  function resolvePath(filePath: string, importer: string | undefined): string {
    return resolveInlinePath(filePath, importer)
  }

  /** Shared generateBundle logic for Rollup-compatible bundlers */
  type RollupPluginContext = {
    emitFile: (file: { type: 'chunk'; id: string }) => string
    getFileName: (refId: string) => string
  }

  type RollupBundle = Record<string, import('./internal/inline-utils').RollupOutput>

  type EsbuildOutputFile = {
    path: string
    text: string
    contents: Uint8Array
  }

  type EsbuildResult = {
    outputFiles?: EsbuildOutputFile[]
  }

  async function rollupGenerateBundle(
    ctx: RollupPluginContext,
    bundle: RollupBundle,
  ) {
    await replaceInlineMarkersInBundle(
      bundle,
      inlineRegistry,
      (refId) => ctx.getFileName(refId),
      async (filePath) => {
        try {
          return await readFile(filePath, 'utf-8')
        } catch {
          return null
        }
      },
    )

    // HTML inlining
    for (const [fileName, asset] of Object.entries(bundle)) {
      if (!fileName.endsWith('.html')) continue
      if (asset.type !== 'asset' || typeof asset.source !== 'string') continue

      asset.source = await transformHtml(asset.source, async (src) => {
        const normalized = src.replace(/^\.?\//, '')
        for (const [name, chunk] of Object.entries(bundle)) {
          if (name === normalized || name.endsWith(normalized)) {
            if (chunk.type === 'chunk') return chunk.code
            if (chunk.type === 'asset' && typeof chunk.source === 'string') return chunk.source
          }
        }
        return null
      }, options)
    }
  }

  /** Shared resolveId for Rollup-compatible bundlers (Rollup/Rolldown) */
  function rollupResolveId(ctx: RollupPluginContext, source: string, importer: string | undefined) {
    // CSS loader virtual module (emitted by us)
    if (source.startsWith(CSS_LOADER_PREFIX)) return source

    if (!source.endsWith(QUERY)) return null
    const filePath = source.slice(0, -QUERY.length)
    const resolved = resolvePath(filePath, importer)
    const type = getInlineFileType(resolved)
    const marker = registerMarker(resolved, type)
    const entry = inlineRegistry.get(marker)!
    if (type === 'js') {
      entry.refId = ctx.emitFile({ type: 'chunk', id: resolved })
    } else {
      entry.refId = ctx.emitFile({ type: 'chunk', id: `${CSS_LOADER_PREFIX}${marker}` })
    }
    return `${BUILD_PREFIX}${marker}`
  }

  /** Shared load for Rollup-compatible bundlers */
  function rollupLoad(id: string) {
    if (id.startsWith(CSS_LOADER_PREFIX)) {
      const marker = id.slice(CSS_LOADER_PREFIX.length)
      const entry = inlineRegistry.get(marker)
      if (entry) return `import ${JSON.stringify(entry.filePath)}`
      return null
    }
    if (!id.startsWith(BUILD_PREFIX)) return null
    const marker = id.slice(BUILD_PREFIX.length)
    return `export default "${marker}"`
  }

  const viteHtml = createViteHtmlHandlers(attr, options, inlineRegistry, registerMarker)

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',

    // ── All-bundler hooks ──
    // For bundlers with output hooks (Vite/Rollup/Rolldown/Webpack/esbuild/Rspack):
    //   resolveId → marker virtual module, load → placeholder, output hook → replace
    // For bundlers without output hooks (Farm/Bun):
    //   resolveId → resolved path with query, load → bundled content

    transform(code: string, id: string) {
      if (!/\.[jt]sx$/.test(id)) return
      return transformJsx(code, attr, { raw: QUERY, inline: QUERY })
    },

    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith(QUERY)) return null
      const filePath = source.slice(0, -QUERY.length)
      const resolved = resolvePath(filePath, importer)

      if (useMarkers) {
        const marker = registerMarker(resolved, getInlineFileType(resolved))
        return `${BUILD_PREFIX}${marker}`
      }

      // Fallback: pass through resolved path with query
      return `${resolved}${QUERY}`
    },

    async load(id: string) {
      // Marker placeholder (for bundlers with output hooks)
      if (id.startsWith(BUILD_PREFIX)) {
        const marker = id.slice(BUILD_PREFIX.length)
        return `export default "${marker}"`
      }

      // Direct file content (for bundlers without output hooks)
      if (id.endsWith(QUERY)) {
        const filePath = id.slice(0, -QUERY.length)
        const type = getInlineFileType(filePath)
        if (meta.framework === 'bun') {
          const result = await buildWithBun(filePath, type, options?.build?.bun)
          for (const warning of result.warnings) {
            console.warn(`[${PLUGIN_NAME}] ${warning}`)
          }
          if (result.content != null) {
            return `export default ${JSON.stringify(result.content)}`
          }
        }
        if (meta.framework === 'farm') {
          const result = await buildWithFarm(filePath, type, options?.build?.farm)
          for (const warning of result.warnings) {
            console.warn(`[${PLUGIN_NAME}] ${warning}`)
          }
          if (result.content != null) {
            return `export default ${JSON.stringify(result.content)}`
          }
        }
        const content = await readFile(filePath, 'utf-8')
        return `export default ${JSON.stringify(content)}`
      }

      return null
    },

    // ── Vite ──

    vite: {
      enforce: 'pre',

      transform(code: string, id: string) {
        if (!/\.[jt]sx$/.test(id)) return
        return transformJsx(code, attr, { raw: QUERY, inline: QUERY })
      },

      ...viteHtml,
    },

    // ── Rollup ──

    rollup: {
      resolveId(this: RollupPluginContext, source: string, importer: string | undefined) {
        return rollupResolveId(this, source, importer)
      },
      load: rollupLoad,
      async generateBundle(this: RollupPluginContext, _: unknown, bundle: RollupBundle) {
        await rollupGenerateBundle(this, bundle)
      },
    },

    // ── Rolldown ──

    rolldown: {
      resolveId(this: RollupPluginContext, source: string, importer: string | undefined) {
        return rollupResolveId(this, source, importer)
      },
      load: rollupLoad,
      async generateBundle(this: RollupPluginContext, _: unknown, bundle: RollupBundle) {
        await rollupGenerateBundle(this, bundle)
      },
    },

    // ── Webpack ──

    webpack(compiler: unknown) {
      if (typeof compiler !== 'object' || compiler == null) return
      if (!('hooks' in compiler)) return
      if (!('webpack' in compiler)) return
      const webpackCompiler = compiler as {
        hooks: { compilation: { tap: (name: string, callback: (compilation: WebpackCompilation) => void) => void } }
        webpack?: { Compilation?: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }; sources?: { RawSource: new (code: string) => unknown }; EntryPlugin?: new (...args: unknown[]) => { apply: (compiler: unknown) => void } }
        context?: string
      }
      if (!webpackCompiler.hooks?.compilation?.tap) return
      type WebpackAssetSource = { source: () => string | Buffer }
      type WebpackAssets = Record<string, WebpackAssetSource>
      type WebpackCompilation = {
        hooks: { processAssets: { tapPromise: (options: { name: string; stage: number }, callback: (assets: WebpackAssets) => Promise<void>) => void } }
        createChildCompiler: (name: string, options: { filename: string }, plugins: unknown[]) => { compile: (callback: (err: unknown, childCompilation: { assets: WebpackAssets; errors: unknown[] }) => void) => void }
        updateAsset: (name: string, source: unknown) => void
        constructor: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }
      }
      webpackCompiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: WebpackCompilation) => {
        compilation.hooks.processAssets.tapPromise(
          {
            name: PLUGIN_NAME,
            stage: (webpackCompiler.webpack?.Compilation ?? compilation.constructor)
              .PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
          },
          async (assets: WebpackAssets) => {
            // Build inline entries via child compiler
            for (const [marker, entry] of inlineRegistry) {
              let content: string | null = null
              try {
                const childCompiler = compilation.createChildCompiler(
                  `${PLUGIN_NAME}:${marker}`,
                  { filename: `__inline_build_${marker}.js` },
                  [],
                )
                const EntryPlugin = webpackCompiler.webpack?.EntryPlugin ?? require('webpack').EntryPlugin
                new EntryPlugin(
                  webpackCompiler.context,
                  entry.filePath,
                  { name: marker },
                ).apply(childCompiler)

                const childAssets = await new Promise<WebpackAssets>((res, rej) => {
                  childCompiler.compile((err: unknown, childCompilation: { assets: WebpackAssets; errors: unknown[] }) => {
                    if (err) return rej(err)
                    if (childCompilation.errors.length > 0) return rej(childCompilation.errors[0])
                    res(childCompilation.assets)
                  })
                })

                for (const childSource of Object.values(childAssets)) {
                  if (!childSource || typeof childSource !== 'object') continue
                  if (!('source' in childSource)) continue
                  const maybeSource = childSource.source
                  if (typeof maybeSource !== 'function') continue
                  const sourceValue = maybeSource()
                  content = String(sourceValue)
                  break
                }
              } catch (e) {
                console.warn(`[${PLUGIN_NAME}] Failed to build ${entry.filePath}:`, e)
              }

              if (content == null) continue

              // Replace markers in all JS assets
              for (const [name, source] of Object.entries(assets)) {
                if (!name.endsWith('.js')) continue
                const text = source.source().toString()
                if (text.includes(marker)) {
                  const RawSource = webpackCompiler.webpack?.sources?.RawSource
                  if (!RawSource) continue
                  const replaced = text.replace(
                    new RegExp(`"${marker}"`, 'g'),
                    JSON.stringify(content),
                  )
                  compilation.updateAsset(name, new RawSource(replaced))
                }
              }
            }

            // HTML inlining
            for (const [fileName, source] of Object.entries(assets)) {
              if (!fileName.endsWith('.html')) continue

              const html = source.source().toString()
              const result = await transformHtml(html, async (src) => {
                const normalized = src.replace(/^\.?\//, '')
                for (const [name, assetSource] of Object.entries(assets)) {
                  if (name === normalized || name.endsWith(normalized)) {
                    return assetSource.source().toString()
                  }
                }
                return null
              }, options)

              const RawSource = webpackCompiler.webpack?.sources?.RawSource
              if (!RawSource) continue
              compilation.updateAsset(fileName, new RawSource(result))
            }
          },
        )
      })
    },

    // ── Rspack (webpack-compatible API) ──

    rspack(compiler: unknown) {
      if (typeof compiler !== 'object' || compiler == null) return
      if (!('hooks' in compiler)) return
      const rspackCompiler = compiler as {
        hooks: { compilation: { tap: (name: string, callback: (compilation: RspackCompilation) => void) => void } }
        webpack?: { Compilation?: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }; sources?: { RawSource: new (code: string) => unknown }; EntryPlugin?: new (...args: unknown[]) => { apply: (compiler: unknown) => void } }
        context?: string
      }
      type RspackAssetSource = { source: () => string | Buffer }
      type RspackAssets = Record<string, RspackAssetSource>
      type RspackCompilation = {
        hooks: { processAssets: { tapPromise: (options: { name: string; stage: number }, callback: (assets: RspackAssets) => Promise<void>) => void } }
        createChildCompiler: (name: string, options: { filename: string }, plugins: unknown[]) => { compile: (callback: (err: unknown, childCompilation: { assets: RspackAssets; errors: unknown[] }) => void) => void }
        updateAsset: (name: string, source: unknown) => void
        constructor: { PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE: number }
      }
      if (!rspackCompiler.hooks?.compilation?.tap) return
      rspackCompiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: RspackCompilation) => {
        compilation.hooks.processAssets.tapPromise(
          {
            name: PLUGIN_NAME,
            stage: (rspackCompiler.webpack?.Compilation ?? compilation.constructor)
              .PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
          },
          async (assets: RspackAssets) => {
            for (const [marker, entry] of inlineRegistry) {
              let content: string | null = null
              try {
                const childCompiler = compilation.createChildCompiler(
                  `${PLUGIN_NAME}:${marker}`,
                  { filename: `__inline_build_${marker}.js` },
                  [],
                )
                const EntryPlugin = rspackCompiler.webpack?.EntryPlugin
                if (EntryPlugin) {
                  new EntryPlugin(
                    rspackCompiler.context,
                    entry.filePath,
                    { name: marker },
                  ).apply(childCompiler)
                }

                const childAssets = await new Promise<RspackAssets>((res, rej) => {
                  childCompiler.compile((err: unknown, childCompilation: { assets: RspackAssets; errors: unknown[] }) => {
                    if (err) return rej(err)
                    if (childCompilation.errors.length > 0) return rej(childCompilation.errors[0])
                    res(childCompilation.assets)
                  })
                })

                for (const childSource of Object.values(childAssets)) {
                  if (!childSource || typeof childSource !== 'object') continue
                  if (!('source' in childSource)) continue
                  const maybeSource = childSource.source
                  if (typeof maybeSource !== 'function') continue
                  const sourceValue = maybeSource()
                  content = String(sourceValue)
                  break
                }
              } catch {
                try {
                  content = await readFile(entry.filePath, 'utf-8')
                } catch { /* ignore */ }
              }

              if (content == null) continue

              for (const [name, source] of Object.entries(assets)) {
                if (!name.endsWith('.js')) continue
                const text = source.source().toString()
                if (text.includes(marker)) {
                  const RawSource = rspackCompiler.webpack?.sources?.RawSource
                  if (RawSource) {
                    const replaced = text.replace(
                      new RegExp(`"${marker}"`, 'g'),
                      JSON.stringify(content),
                    )
                    compilation.updateAsset(name, new RawSource(replaced))
                  }
                }
              }
            }

            // HTML inlining
            for (const [fileName, source] of Object.entries(assets)) {
              if (!fileName.endsWith('.html')) continue

              const html = source.source().toString()
              const result = await transformHtml(html, async (src) => {
                const normalized = src.replace(/^\.?\//, '')
                for (const [name, assetSource] of Object.entries(assets)) {
                  if (name === normalized || name.endsWith(normalized)) {
                    return assetSource.source().toString()
                  }
                }
                return null
              }, options)

              const RawSource = rspackCompiler.webpack?.sources?.RawSource
              if (RawSource) {
                compilation.updateAsset(fileName, new RawSource(result))
              }
            }
          },
        )
      })
    },

    // ── esbuild ──

    esbuild: {
      setup(build: { onEnd: (callback: (result: EsbuildResult) => void) => void }) {
        build.onEnd(async (result: EsbuildResult) => {
          if (!result.outputFiles) return

          // @ts-ignore esbuild is available at runtime in esbuild plugin context
          const esbuild = await import('esbuild')
          for (const [marker, entry] of inlineRegistry) {
            let content: string | null = null
            try {
              const buildResult = await esbuild.build({
                entryPoints: [entry.filePath],
                bundle: true,
                write: false,
                minify: true,
                loader: entry.type === 'css' ? { '.css': 'css' } : undefined,
              })
              if (buildResult.outputFiles?.[0]) {
                content = buildResult.outputFiles[0].text
              }
            } catch (e) {
              console.warn(`[${PLUGIN_NAME}] Failed to build ${entry.filePath}:`, e)
            }

            if (content == null) continue

            for (const file of result.outputFiles) {
              const text = file.text
              if (text.includes(marker)) {
                const replaced = text.replace(
                  new RegExp(`"${marker}"`, 'g'),
                  JSON.stringify(content),
                )
                file.contents = new TextEncoder().encode(replaced)
              }
            }
          }

          // HTML inlining
          for (const file of result.outputFiles) {
            if (!file.path.endsWith('.html')) continue

            const html = file.text
            const outputFiles = result.outputFiles ?? []
            const transformed = await transformHtml(html, async (src) => {
              const dir = dirname(file.path)
              const resolved = resolve(dir, src)
              const match = outputFiles.find((outputFile) => outputFile.path === resolved)
              if (match) return match.text
              try {
                return await readFile(resolved, 'utf-8')
              } catch {
                return null
              }
            }, options)

            file.contents = new TextEncoder().encode(transformed)
          }
        })
      },
    },
  }
})

export default unplugin
