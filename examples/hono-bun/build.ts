import { plugins } from './plugins'

// Build with minification enabled
const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  plugins,
  target: 'bun',
  outdir: './dist',
  minify: {
    whitespace: true,
    syntax: true,
    identifiers: true,
  },
})

if (!result.success) {
  console.error('Build failed')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log('Build successful!')
for (const output of result.outputs) {
  console.log('Output:', output.path)
}
