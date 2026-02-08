import { test, expect, describe } from 'bun:test'
import { transformJsx } from '../src/core'

const buildQueries = { raw: '?__inline_build', inline: '?__inline_build' }

describe('transformJsx', () => {
  test('transforms script tag with inline src', () => {
    const code = `export default () => <div><script inline src="./app.js"></script></div>`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './app.js?__inline_build'`)
    expect(result).toContain('dangerouslySetInnerHTML={{__html: __inline_0}}')
    expect(result).not.toContain('src="./app.js"')
    expect(result).not.toContain(' inline')
  })

  test('transforms link tag with inline rel="stylesheet"', () => {
    const code = `export default () => <head><link inline rel="stylesheet" href="./style.css" /></head>`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './style.css?__inline_build'`)
    expect(result).toContain('dangerouslySetInnerHTML={{__html: __inline_0}}')
    expect(result).toContain('<style')
    expect(result).not.toContain('href="./style.css"')
    expect(result).not.toContain('<link')
  })

  test('preserves other attributes on script tags', () => {
    const code = `<script inline src="./app.js" type="module"></script>`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain('type="module"')
    expect(result).toContain('dangerouslySetInnerHTML')
    expect(result).not.toContain('src=')
    expect(result).not.toContain(' inline ')
  })

  test('preserves other attributes on link tags', () => {
    const code = `<link inline rel="stylesheet" href="./style.css" media="print" />`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain('media="print"')
    expect(result).toContain('<style')
    expect(result).not.toContain('href=')
  })

  test('handles multiple tags', () => {
    const code = `
export default () => (
  <html>
    <head>
      <link inline rel="stylesheet" href="./a.css" />
      <link inline rel="stylesheet" href="./b.css" />
    </head>
    <body>
      <script inline src="./x.js"></script>
      <script inline src="./y.js"></script>
    </body>
  </html>
)`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './x.js?__inline_build'`)
    expect(result).toContain(`import __inline_1 from './y.js?__inline_build'`)
    expect(result).toContain(`import __inline_2 from './a.css?__inline_build'`)
    expect(result).toContain(`import __inline_3 from './b.css?__inline_build'`)
    expect(result).not.toContain('src="./x.js"')
    expect(result).not.toContain('href="./a.css"')
  })

  test('supports custom attribute name', () => {
    const code = `<script data-inline src="./app.js"></script>`
    const result = transformJsx(code, 'data-inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './app.js?__inline_build'`)
    expect(result).toContain('dangerouslySetInnerHTML')
  })

  test('returns null for non-matching code', () => {
    const code = `export default () => <div>Hello</div>`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toBeNull()
  })

  test('does not transform tags without inline attribute', () => {
    const code = `<script src="./app.js"></script><link rel="stylesheet" href="./style.css" />`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toBeNull()
  })

  test('does not transform link without rel="stylesheet"', () => {
    const code = `<link inline rel="icon" href="./favicon.ico" />`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toBeNull()
  })

  test('handles self-closing script tags', () => {
    const code = `<script inline src="./app.js" />`
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './app.js?__inline_build'`)
    expect(result).toContain('dangerouslySetInnerHTML')
  })

  test('uses same query for both JS and CSS', () => {
    const code = `
      <script inline src="./app.js"></script>
      <link inline rel="stylesheet" href="./style.css" />
    `
    const result = transformJsx(code, 'inline', buildQueries)

    expect(result).toContain(`import __inline_0 from './app.js?__inline_build'`)
    expect(result).toContain(`import __inline_1 from './style.css?__inline_build'`)
  })
})
