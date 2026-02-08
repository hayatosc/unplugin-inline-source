import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/core.ts',
    'src/index.ts',
    'src/vite.ts',
    'src/rollup.ts',
    'src/webpack.ts',
    'src/esbuild.ts',
    'src/rspack.ts',
    'src/rolldown.ts',
    'src/farm.ts',
    'src/bun.ts',
    'src/types.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  skipNodeModulesBundle: true,
  external: ['@farmfe/core', 'esbuild'],
  clean: true,
})
