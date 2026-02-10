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

## Configuration

### bunfig.toml

The `bunfig.toml` file provides configuration for the Bun runtime. Plugin loading is handled through dedicated scripts for better control:

```toml
# Plugins are loaded via server.ts (dev/preview) and build.ts (build)
# This approach provides better control over plugin initialization
```

### Plugin Registration

Plugins are centrally defined in `plugins.ts`:
- `runtimePlugins` - Used by `server.ts` for dev/preview (includes both unplugin-inline-source and bun-plugin-tailwind)
- `buildPlugins` - Used by `build.ts` for production builds (tailwind only, as unplugin-inline-source has compatibility issues with Bun.build())

This ensures consistent and maintainable plugin configuration across all environments.

## Notes

- `bunfig.toml` automatically loads the plugin configuration on startup
- `bun-plugin-tailwind` processes `@import "tailwindcss"` in CSS files
- `unplugin-inline-source` inlines `<link inline>` and `<script inline>` elements
