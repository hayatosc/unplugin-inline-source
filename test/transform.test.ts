import { test, expect, describe } from 'bun:test'
import { transformHtml, type ResolveContent } from '../src/core'

function createResolver(files: Record<string, string>): ResolveContent {
  return async (path) => files[path] ?? null
}

describe('transformHtml', () => {
  test('inlines a script tag', async () => {
    const html = '<html><head></head><body><script inline src="./app.js"></script></body></html>'
    const resolve = createResolver({ './app.js': 'console.log("hello")' })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('<script>console.log("hello")</script>')
    expect(result).not.toContain('src=')
    expect(result).not.toContain('inline')
  })

  test('inlines a stylesheet link', async () => {
    const html = '<html><head><link inline rel="stylesheet" href="./style.css" /></head></html>'
    const resolve = createResolver({ './style.css': 'body { color: red; }' })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('<style>body { color: red; }</style>')
    expect(result).not.toContain('<link')
    expect(result).not.toContain('href=')
  })

  test('preserves other attributes on script tags', async () => {
    const html = '<script inline src="./app.js" type="module" defer></script>'
    const resolve = createResolver({ './app.js': 'export default 1' })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('type="module"')
    expect(result).toContain('defer')
    expect(result).not.toContain('src=')
    expect(result).not.toContain(' inline')
  })

  test('preserves other attributes on link tags', async () => {
    const html = '<link inline rel="stylesheet" href="./style.css" media="print" />'
    const resolve = createResolver({ './style.css': '.a{}' })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('<style media="print">.a{}</style>')
  })

  test('escapes </script> in inlined content', async () => {
    const html = '<script inline src="./app.js"></script>'
    const resolve = createResolver({ './app.js': 'var x = "</script>"' })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('<\\/script>')
    expect(result).not.toContain('</script>"')
  })

  test('leaves tag unchanged when file cannot be resolved', async () => {
    const html = '<script inline src="./missing.js"></script>'
    const resolve = createResolver({})

    const result = await transformHtml(html, resolve)

    expect(result).toContain('src="./missing.js"')
    expect(result).toContain('inline')
  })

  test('does not modify tags without inline attribute', async () => {
    const html = '<script src="./app.js"></script><link rel="stylesheet" href="./style.css" />'
    const resolve = createResolver({
      './app.js': 'console.log("hello")',
      './style.css': 'body{}',
    })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('src="./app.js"')
    expect(result).toContain('href="./style.css"')
  })

  test('supports custom attribute name', async () => {
    const html = '<script data-inline src="./app.js"></script>'
    const resolve = createResolver({ './app.js': 'alert(1)' })

    const result = await transformHtml(html, resolve, { attribute: 'data-inline' })

    expect(result).toContain('<script>alert(1)</script>')
  })

  test('handles multiple tags', async () => {
    const html = `
<html>
<head>
  <link inline rel="stylesheet" href="./a.css" />
  <link inline rel="stylesheet" href="./b.css" />
</head>
<body>
  <script inline src="./x.js"></script>
  <script inline src="./y.js"></script>
</body>
</html>`
    const resolve = createResolver({
      './a.css': '.a{}',
      './b.css': '.b{}',
      './x.js': 'var x=1',
      './y.js': 'var y=2',
    })

    const result = await transformHtml(html, resolve)

    expect(result).toContain('<style>.a{}</style>')
    expect(result).toContain('<style>.b{}</style>')
    expect(result).toContain('<script>var x=1</script>')
    expect(result).toContain('<script>var y=2</script>')
    expect(result).not.toContain('src=')
    expect(result).not.toContain('href=')
  })

  test('does not inline link tags without rel="stylesheet"', async () => {
    const html = '<link inline rel="icon" href="./favicon.ico" />'
    const resolve = createResolver({ './favicon.ico': 'icon-data' })

    const result = await transformHtml(html, resolve)

    // Should remain unchanged since rel is not "stylesheet"
    expect(result).toContain('href="./favicon.ico"')
  })

  test('handles script tag without src attribute', async () => {
    const html = '<script inline>console.log("already inline")</script>'
    const resolve = createResolver({})

    const result = await transformHtml(html, resolve)

    expect(result).toContain('console.log("already inline")')
  })
})
