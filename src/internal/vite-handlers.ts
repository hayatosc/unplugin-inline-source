import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transformHtml, collectMatches, parseAttributes, formatAttributes, type TransformOptions, type InlineEntry } from '../core'
import { INLINE_QUERY, CSS_LOADER_PREFIX, BUILD_PREFIX, getInlineFileType, resolveInlinePath, replaceInlineMarkersInBundle, type RollupOutput } from './inline-utils'

export function createViteHtmlHandlers(
  attr: string,
  options: TransformOptions | undefined,
  inlineRegistry: Map<string, InlineEntry>,
  registerMarker: (filePath: string, type: 'js' | 'css') => string,
) {
  const inlineScripts = new Set<string>()
  const inlineStyles = new Set<string>()

  let isBuild = false
  let projectRoot = process.cwd()

  type ViteChunk = { type: 'chunk'; code: string; modules?: Record<string, unknown> }
  type ViteOutput = RollupOutput | ViteChunk

  function inlineBundledContent(bundle: Record<string, ViteOutput>, html: string): string {
    const chunkNamesToInline = new Set<string>()
    const assetNamesToInline = new Set<string>()

    for (const [name, chunk] of Object.entries(bundle)) {
      if (chunk.type === 'chunk' && 'modules' in chunk && chunk.modules) {
        for (const modId of Object.keys(chunk.modules)) {
          if (inlineScripts.has(modId)) {
            chunkNamesToInline.add(name)
            break
          }
        }
      }
      if (chunk.type === 'asset' && inlineStyles.size > 0 && name.endsWith('.css')) {
        assetNamesToInline.add(name)
      }
    }

    let result = html

    // Inline JS
    const scriptMatches = collectMatches(result, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
    for (const match of scriptMatches.reverse()) {
      const attrs = parseAttributes(match[1])
      if (!('src' in attrs)) continue
      const normalized = attrs.src.replace(/^\//, '')
      if (!chunkNamesToInline.has(normalized)) continue
      const chunk = bundle[normalized]
      if (!chunk || chunk.type !== 'chunk') continue
      const attrStr = formatAttributes(attrs, ['src', 'crossorigin'])
      const escaped = chunk.code.replace(/<\/script>/gi, '<\\/script>')
      result = result.slice(0, match.index) + `<script${attrStr}>${escaped}</script>` + result.slice(match.index + match[0].length)
    }

    // Inline CSS
    const linkMatches = collectMatches(result, /<link\b([^>]*?)\/?\s*>/gi)
    for (const match of linkMatches.reverse()) {
      const attrs = parseAttributes(match[1])
      if (attrs.rel !== 'stylesheet' || !('href' in attrs)) continue
      const normalized = attrs.href.replace(/^\//, '')
      if (!assetNamesToInline.has(normalized)) continue
      const cssAsset = bundle[normalized]
      if (!cssAsset || cssAsset.type !== 'asset') continue
      const content = typeof cssAsset.source === 'string' ? cssAsset.source : cssAsset.source.toString()
      const attrStr = formatAttributes(attrs, ['rel', 'href', 'crossorigin'])
      result = result.slice(0, match.index) + `<style${attrStr}>${content}</style>` + result.slice(match.index + match[0].length)
    }

    return result
  }

  type ViteConfig = { command: string; root?: string }
  type ViteServerContext = { server?: { config: { root?: string } } }
  type VitePluginContext = {
    emitFile: (file: { type: 'chunk'; id: string }) => string
    getFileName: (refId: string) => string
  }
  type ViteBundle = Record<string, ViteOutput>

  return {
    configResolved(config: ViteConfig) {
      isBuild = config.command === 'build'
      projectRoot = config.root ?? process.cwd()
    },

    resolveId(this: VitePluginContext, source: string, importer: string | undefined) {
      // CSS loader virtual module (emitted by us)
      if (source.startsWith(CSS_LOADER_PREFIX)) return source

      if (!source.endsWith(INLINE_QUERY)) return null
      const filePath = source.slice(0, -INLINE_QUERY.length)
      const resolved = resolveInlinePath(filePath, importer, projectRoot)
      const type = getInlineFileType(resolved)

      if (isBuild) {
        const marker = registerMarker(resolved, type)
        const entry = inlineRegistry.get(marker)!
        if (type === 'js') {
          entry.refId = this.emitFile({ type: 'chunk', id: resolved })
        } else {
          // Emit a wrapper chunk that imports the CSS → triggers CSS pipeline
          entry.refId = this.emitFile({ type: 'chunk', id: `${CSS_LOADER_PREFIX}${marker}` })
        }
        return `${BUILD_PREFIX}${marker}`
      }

      // Dev mode: just read the file
      return `${resolved}${INLINE_QUERY}`
    },

    async load(id: string) {
      // CSS loader: import CSS to trigger bundler CSS pipeline
      if (id.startsWith(CSS_LOADER_PREFIX)) {
        const marker = id.slice(CSS_LOADER_PREFIX.length)
        const entry = inlineRegistry.get(marker)
        if (entry) return `import ${JSON.stringify(entry.filePath)}`
        return null
      }

      // Virtual module placeholder
      if (id.startsWith(BUILD_PREFIX)) {
        const marker = id.slice(BUILD_PREFIX.length)
        return `export default "${marker}"`
      }

      // Dev mode: read file directly
      if (id.endsWith(INLINE_QUERY)) {
        const filePath = id.slice(0, -INLINE_QUERY.length)
        const content = await readFile(filePath, 'utf-8')
        return `export default ${JSON.stringify(content)}`
      }

      return null
    },

    transformIndexHtml: {
      order: 'pre',
      async handler(html: string, ctx: ViteServerContext) {
        const root = ctx.server?.config.root ?? projectRoot

        if (ctx.server) {
          // Dev mode: inline directly from disk
          return await transformHtml(html, async (src) => {
            const resolved = resolve(root, src.replace(/^[\/@]/, ''))
            try {
              return await readFile(resolved, 'utf-8')
            } catch {
              return null
            }
          }, options)
        }

        // Build mode: record inline targets, strip attr so Vite processes normally
        let result = html

        const scriptMatches = collectMatches(result, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
        for (const match of scriptMatches.reverse()) {
          const attrs = parseAttributes(match[1])
          if (!(attr in attrs) || !('src' in attrs)) continue
          inlineScripts.add(resolve(root, attrs.src.replace(/^\//, '')))
          const attrStr = formatAttributes(attrs, [attr])
          result = result.slice(0, match.index) + `<script${attrStr}>${match[2]}</script>` + result.slice(match.index + match[0].length)
        }

        const linkMatches = collectMatches(result, /<link\b([^>]*?)\/?\s*>/gi)
        for (const match of linkMatches.reverse()) {
          const attrs = parseAttributes(match[1])
          if (!(attr in attrs) || attrs.rel !== 'stylesheet' || !('href' in attrs)) continue
          inlineStyles.add(resolve(root, attrs.href.replace(/^\//, '')))
          const attrStr = formatAttributes(attrs, [attr])
          result = result.slice(0, match.index) + `<link${attrStr} />` + result.slice(match.index + match[0].length)
        }

        if (inlineScripts.size === 0 && inlineStyles.size === 0) return html
        return result
      },
    },

    async generateBundle(this: VitePluginContext, _: unknown, bundle: ViteBundle) {
      await replaceInlineMarkersInBundle(
        bundle,
        inlineRegistry,
        (refId) => this.getFileName(refId),
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
        asset.source = inlineBundledContent(bundle, asset.source)
      }
    },
  }
}
