import { Hono } from 'hono'
import type { FC } from 'hono/jsx'

const Page: FC = () => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Hono + Cloudflare + Inline Source</title>
      <link inline rel="stylesheet" href="/src/style.css" />
    </head>
    <body class="bg-gray-100 max-w-xl mx-auto p-4 mt-8">
      <div id="app">
        <div class="bg-white rounded-lg p-8 shadow-md">
          <h1 class="text-2xl font-bold mb-2">unplugin-inline-source</h1>
          <p class="text-gray-600 mb-6">CSS and JS are inlined at build time</p>
          <button class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 cursor-pointer">
            Fetch API
          </button>
          <pre class="bg-gray-100 p-4 rounded mt-4 min-h-12 text-sm overflow-x-auto"></pre>
        </div>
      </div>
      <script inline src="/src/client.tsx"></script>
    </body>
  </html>
)

const app = new Hono()

app.get('/api/hello', (c) => {
  return c.json({ message: 'Hello from Hono on Cloudflare Workers!' })
})

app.get('/', (c) => {
  return c.html(<Page />)
})

export default app
