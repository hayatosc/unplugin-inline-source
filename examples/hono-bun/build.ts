// Simple build script for Bun
// Note: unplugin-inline-source works best with runtime (dev/preview)
// Build mode currently uses basic bundling
const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
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
