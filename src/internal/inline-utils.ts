import { resolve, dirname, basename } from 'node:path'
import type { InlineEntry } from '../core'

export const INLINE_QUERY = '?__inline_build'
export const CSS_LOADER_PREFIX = '\0inline-css:'
export const BUILD_PREFIX = '\0inline-build:'

export function resolveInlinePath(
  filePath: string,
  importer: string | undefined,
  root = process.cwd(),
): string {
  if (filePath.startsWith('/')) {
    return resolve(root, filePath.slice(1))
  }
  if (importer) {
    return resolve(dirname(importer.replace(/\?.*$/, '')), filePath)
  }
  return resolve(root, filePath)
}

export function getInlineFileType(filePath: string): 'js' | 'css' {
  return /\.css$/i.test(filePath) ? 'css' : 'js'
}

type RollupChunk = {
  type: 'chunk'
  code: string
  viteMetadata?: { importedCss?: Set<string> }
}

type RollupAsset = {
  type: 'asset'
  source: string | Buffer | Uint8Array
}

export type RollupOutput = RollupChunk | RollupAsset

export function extractCssFromWrapper(
  bundle: Record<string, RollupOutput>,
  entry: InlineEntry,
  wrapperChunk: RollupChunk,
): string | null {
  const importedCss = wrapperChunk.viteMetadata?.importedCss
  if (importedCss && importedCss instanceof Set && importedCss.size > 0) {
    for (const cssName of importedCss) {
      const cssAsset = bundle[cssName]
      if (cssAsset?.type === 'asset') {
        const content = typeof cssAsset.source === 'string' ? cssAsset.source : cssAsset.source.toString()
        delete bundle[cssName]
        importedCss.delete(cssName)
        return content
      }
    }
  }

  const base = basename(entry.filePath, '.css')
  for (const [assetName, asset] of Object.entries(bundle)) {
    if (asset.type !== 'asset' || !assetName.endsWith('.css')) continue
    if (assetName.includes(base)) {
      const content = typeof asset.source === 'string' ? asset.source : asset.source.toString()
      delete bundle[assetName]
      return content
    }
  }
  return null
}

export async function replaceInlineMarkersInBundle(
  bundle: Record<string, RollupOutput>,
  inlineRegistry: Map<string, InlineEntry>,
  getFileName: (refId: string) => string,
  readFile: (filePath: string) => Promise<string | null>,
) {
  for (const [marker, entry] of inlineRegistry) {
    let content: string | null = null

    if (entry.refId) {
      try {
        const fileName = getFileName(entry.refId)
        const chunk = bundle[fileName]
        if (chunk?.type === 'chunk') {
          if (entry.type === 'js') {
            content = chunk.code
          } else {
            content = extractCssFromWrapper(bundle, entry, chunk)
          }
          delete bundle[fileName]
        }
      } catch {
        // ignore
      }
    }

    if (content == null) {
      content = await readFile(entry.filePath)
    }
    if (content == null) continue

    for (const chunk of Object.values(bundle)) {
      if (chunk.type === 'chunk' && chunk.code.includes(marker)) {
        chunk.code = chunk.code.replace(
          new RegExp(`"${marker}"`, 'g'),
          JSON.stringify(content),
        )
      }
    }
  }
}
