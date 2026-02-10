import { createUnplugin } from 'unplugin'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { transformHtml, transformJsx, type TransformOptions, type InlineEntry } from './core'
import { createViteHtmlHandlers } from './vite-html'
import {
  INLINE_QUERY,
  CSS_LOADER_PREFIX,
  BUILD_PREFIX,
  resolveInlinePath,
  getInlineFileType,
  replaceInlineMarkersInBundle,
} from './internal/inline-utils'
import {
  inlineHtmlAssets,
  replaceMarkerInText,
  createWebpackLikeHandler,
} from './internal/bundler-helpers'

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

    // HTML inlining using shared helper
    const htmlAssets: Array<{ name: string; content: string }> = []
    for (const [fileName, asset] of Object.entries(bundle)) {
      if (fileName.endsWith('.html') && asset.type === 'asset' && typeof asset.source === 'string') {
        htmlAssets.push({ name: fileName, content: asset.source })
      }
    }

    const transformed = await inlineHtmlAssets(
      htmlAssets,
      (normalized) => {
        for (const [name, chunk] of Object.entries(bundle)) {
          if (name === normalized || name.endsWith(normalized)) {
            if (chunk.type === 'chunk') return chunk.code
            if (chunk.type === 'asset' && typeof chunk.source === 'string') return chunk.source
          }
        }
        return null
      },
      options,
    )

    // Update bundle with transformed HTML
    for (const { name, content } of transformed) {
      const asset = bundle[name]
      if (asset && asset.type === 'asset') {
        asset.source = content
      }
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

      // Direct file content (for bundlers without output hooks: Bun, Farm)
      // NOTE: These bundlers don't provide plugin APIs to emit chunks like Rollup.
      // To avoid importing bundler-specific libraries (Bun global, @farmfe/core),
      // we read raw file content directly. This maintains unplugin's abstraction
      // but means inline files won't be transpiled/bundled for these bundlers.
      if (id.endsWith(QUERY)) {
        const filePath = id.slice(0, -QUERY.length)
        try {
          const content = await readFile(filePath, 'utf-8')
          return `export default ${JSON.stringify(content)}`
        } catch (e) {
          console.warn(`[${PLUGIN_NAME}] Failed to read ${filePath}:`, e)
          return `export default ""`
        }
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
      createWebpackLikeHandler(compiler, {
        pluginName: PLUGIN_NAME,
        inlineRegistry,
        transformOptions: options,
        fallbackToRawFile: false,
      })
    },

    // ── Rspack (webpack-compatible API) ──

    rspack(compiler: unknown) {
      createWebpackLikeHandler(compiler, {
        pluginName: PLUGIN_NAME,
        inlineRegistry,
        transformOptions: options,
        fallbackToRawFile: true, // Rspack falls back to raw file on error
      })
    },

    // ── esbuild ──

    esbuild: {
      setup(build: { onEnd: (callback: (result: EsbuildResult) => void) => void }) {
        build.onEnd(async (result: EsbuildResult) => {
          if (!result.outputFiles) return

          // Replace inline entries with raw file content
          // NOTE: esbuild plugin API doesn't support emitting chunks like Rollup,
          // so we can't trigger separate builds without importing esbuild module.
          // To maintain unplugin's abstraction and avoid bundler-specific imports,
          // we read raw files directly. Users needing transpilation should use
          // Vite/Rollup/Webpack/Rspack which have richer plugin APIs.
          for (const [marker, entry] of inlineRegistry) {
            let content: string | null = null
            try {
              content = await readFile(entry.filePath, 'utf-8')
            } catch (e) {
              console.warn(`[${PLUGIN_NAME}] Failed to read ${entry.filePath}:`, e)
            }

            if (content == null) continue

            // Replace markers in output files
            for (const file of result.outputFiles) {
              const text = file.text
              if (text.includes(marker)) {
                const replaced = replaceMarkerInText(text, marker, content)
                file.contents = new TextEncoder().encode(replaced)
              }
            }
          }

          // HTML inlining using shared helper
          const htmlFiles: Array<{ name: string; content: string; file: EsbuildOutputFile }> = []
          for (const file of result.outputFiles) {
            if (file.path.endsWith('.html')) {
              htmlFiles.push({ name: file.path, content: file.text, file })
            }
          }

          const transformed = await inlineHtmlAssets(
            htmlFiles,
            async (normalized) => {
              const dir = dirname(htmlFiles[0].file.path)
              const resolved = resolve(dir, normalized)
              const match = result.outputFiles?.find((f) => f.path === resolved)
              if (match) return match.text
              try {
                return await readFile(resolved, 'utf-8')
              } catch {
                return null
              }
            },
            options,
          )

          // Update HTML files with transformed content
          for (const { name, content } of transformed) {
            const file = result.outputFiles.find((f) => f.path === name)
            if (file) {
              file.contents = new TextEncoder().encode(content)
            }
          }
        })
      },
    },
  }
})

export default unplugin
