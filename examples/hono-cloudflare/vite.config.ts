import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import inlineSource from 'unplugin-inline-source/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    inlineSource(),
    tailwindcss(),
    cloudflare(),
  ],
})
