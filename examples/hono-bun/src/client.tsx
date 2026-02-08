const button = document.querySelector<HTMLButtonElement>('#fetch-button')
const output = document.querySelector<HTMLElement>('#output')
const status = document.querySelector<HTMLElement>('#status')

const setStatus = (value: string) => {
  if (status) status.textContent = value
}

const setOutput = (value: string) => {
  if (output) output.textContent = value
}

const handleClick = async () => {
  if (!button) return
  button.disabled = true
  setStatus('Loading...')
  setOutput('')
  try {
    const res = await fetch('/api/hello')
    const data = await res.json() as { message: string }
    setOutput(JSON.stringify(data, null, 2))
    setStatus('Success')
  } catch {
    setOutput('Request failed')
    setStatus('Failed')
  } finally {
    button.disabled = false
  }
}

if (button) {
  button.addEventListener('click', handleClick)
}
