import { render, useState } from 'hono/jsx/dom'

type ApiResponse = { message: string }

function App() {
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/hello')
      const data = await res.json() as ApiResponse
      setOutput(JSON.stringify(data, null, 2))
    } catch {
      setOutput('Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="bg-white rounded-lg p-8 shadow-md">
      <h1 class="text-2xl font-bold mb-2">unplugin-inline-source</h1>
      <p class="text-gray-600 mb-6">CSS and JS are inlined at build time</p>
      <button
        class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 cursor-pointer disabled:opacity-60"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? 'Loading...' : 'Fetch API'}
      </button>
      <pre class="bg-gray-100 p-4 rounded mt-4 min-h-12 text-sm overflow-x-auto">{output}</pre>
    </div>
  )
}

const root = document.getElementById('app')
if (root) {
  render(<App />, root)
}
