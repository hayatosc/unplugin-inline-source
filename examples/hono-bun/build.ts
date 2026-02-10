import { buildPlugins } from './plugins'

// Build with build-compatible plugins (tailwind only)
const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  plugins: buildPlugins,
  target: 'bun',
  outdir: './dist',
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
