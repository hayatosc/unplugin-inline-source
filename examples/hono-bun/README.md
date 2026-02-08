# Hono + Bun inline example

This example validates Bun plugins with Hono using:

- `bun-plugin-tailwind` for Tailwind CSS v4
- `unplugin-inline-source` for inlining `<link inline>` and `<script inline>`

## Setup

```sh
bun install
```

## Development

Run the Hono server with hot reload:

```sh
bun run dev
```

Open `http://localhost:3000` and click the button to call `/api/hello`.

## Notes

- `Bun.plugin(...)` registers `unplugin-inline-source` before the Hono app is loaded.
- `bun-plugin-tailwind` is injected into the inline build so `@import "tailwindcss"` is compiled.
