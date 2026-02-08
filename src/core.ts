export interface InlineEntry {
  filePath: string
  type: 'js' | 'css'
  refId?: string      // JS: emitted chunk refId, CSS: emitted wrapper chunk refId
}

export interface TransformOptions {
  /**
   * The attribute name to trigger inlining.
   * @default 'inline'
   */
  attribute?: string

  /**
   * Optional bundler build overrides for Bun/Farm inline builds.
   */
  build?: {
    bun?: Record<string, unknown>
    farm?: Record<string, unknown>
  }
}

export type ResolveContent = (path: string) => Promise<string | null>

export function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
  let m
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

export function formatAttributes(attrs: Record<string, string>, exclude: string[]): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (exclude.includes(key)) continue
    parts.push(value === '' ? key : `${key}="${value}"`)
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

export function collectMatches(html: string, regex: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = []
  let m
  while ((m = regex.exec(html)) !== null) matches.push(m)
  return matches
}

/**
 * Transform JSX code by replacing `<script inline src>` and `<link inline rel="stylesheet" href>`
 * with import statements and `dangerouslySetInnerHTML` expressions.
 *
 * Returns `null` if no transformations were made.
 */
export function transformJsx(
  code: string,
  attr: string,
  queries: { raw: string; inline: string },
): string | null {
  if (!new RegExp(`<(?:script|link)\\b[^>]*\\b${attr}\\b`, 'i').test(code)) return null

  let result = code
  const imports: string[] = []
  let counter = 0

  // Process <script inline src="...">...</script> and self-closing <script inline src="..." />
  const scriptRe = new RegExp(`<script\\b([^>]*)\\b${attr}\\b([^>]*)(?:\\/>|>([\\s\\S]*?)<\\/script>)`, 'gi')
  result = result.replace(scriptRe, (match, before, after, _body) => {
    const attrStr = before + attr + after
    const attrs = parseAttributes(attrStr)
    if (!(attr in attrs) || !('src' in attrs)) return match

    const varName = `__inline_${counter++}`
    imports.push(`import ${varName} from '${attrs.src}${queries.raw}'`)

    const remaining = formatAttributes(attrs, [attr, 'src'])
    return `<script${remaining} dangerouslySetInnerHTML={{__html: ${varName}}}></script>`
  })

  // Process <link inline rel="stylesheet" href="..." />
  const linkRe = new RegExp(`<link\\b([^>]*)\\b${attr}\\b([^>]*?)\\/?>`, 'gi')
  result = result.replace(linkRe, (match, before, after) => {
    const attrStr = before + attr + after
    const attrs = parseAttributes(attrStr)
    if (!(attr in attrs) || attrs.rel !== 'stylesheet' || !('href' in attrs)) return match

    const varName = `__inline_${counter++}`
    imports.push(`import ${varName} from '${attrs.href}${queries.inline}'`)

    const remaining = formatAttributes(attrs, [attr, 'rel', 'href'])
    return `<style${remaining} dangerouslySetInnerHTML={{__html: ${varName}}} />`
  })

  if (imports.length === 0) return null
  return imports.join('\n') + '\n' + result
}

/**
 * Transform HTML by inlining external scripts and stylesheets
 * that have the `inline` attribute.
 */
export async function transformHtml(
  html: string,
  resolveContent: ResolveContent,
  options?: TransformOptions,
): Promise<string> {
  const attr = options?.attribute ?? 'inline'
  let result = html

  // Process <script inline src="...">...</script>
  const scriptMatches = collectMatches(result, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi)

  for (const match of scriptMatches.reverse()) {
    const attrs = parseAttributes(match[1])
    if (!(attr in attrs) || !('src' in attrs)) continue

    const content = await resolveContent(attrs.src)
    if (content == null) {
      console.warn(`[unplugin-inline-source] Could not resolve: ${attrs.src}`)
      continue
    }

    const attrStr = formatAttributes(attrs, [attr, 'src'])
    const escaped = content.replace(/<\/script>/gi, '<\\/script>')
    result = result.slice(0, match.index) + `<script${attrStr}>${escaped}</script>` + result.slice(match.index + match[0].length)
  }

  // Process <link inline rel="stylesheet" href="...">
  const linkMatches = collectMatches(result, /<link\b([^>]*?)\/?\s*>/gi)

  for (const match of linkMatches.reverse()) {
    const attrs = parseAttributes(match[1])
    if (!(attr in attrs) || attrs.rel !== 'stylesheet' || !('href' in attrs)) continue

    const content = await resolveContent(attrs.href)
    if (content == null) {
      console.warn(`[unplugin-inline-source] Could not resolve: ${attrs.href}`)
      continue
    }

    const attrStr = formatAttributes(attrs, [attr, 'rel', 'href'])
    result = result.slice(0, match.index) + `<style${attrStr}>${content}</style>` + result.slice(match.index + match[0].length)
  }

  return result
}
