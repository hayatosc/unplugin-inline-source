type BunLoader = import('bun').Loader

type BunBuildConfig = import('bun').BuildConfigBase & Record<string, unknown>

type BunBuildLog = {
  level?: string
  message?: string
  text?: string
}

export type BuildResult = {
  content: string | null
  warnings: string[]
}

type BunBuildOutputFile = { kind: string; text: () => Promise<string> }

type BunBuildOutput = {
  outputs: BunBuildOutputFile[]
  success: boolean
  logs: BunBuildLog[]
}

const DEFAULT_MINIFY = { whitespace: true, syntax: true, identifiers: true }

function pickEntryOutput(outputs: BunBuildOutputFile[]): BunBuildOutputFile | null {
  if (outputs.length === 0) return null
  const entry = outputs.find((output) => output.kind === 'entry-point')
  return entry ?? outputs[0]
}

function collectBuildWarnings(logs: BunBuildLog[]): string[] {
  const warnings: string[] = []
  for (const log of logs) {
    const level = log.level ?? ''
    if (level !== 'warning') continue
    const text = log.message ?? log.text
    if (text) warnings.push(text)
  }
  return warnings
}

function isBunBuildOutput(value: unknown): value is BunBuildOutput {
  if (!value || typeof value !== 'object') return false
  if (!('outputs' in value) || !('success' in value) || !('logs' in value)) return false
  const outputs = value.outputs
  const success = value.success
  const logs = value.logs
  return Array.isArray(outputs) && typeof success === 'boolean' && Array.isArray(logs)
}

function toBunLoader(type: 'js' | 'css'): BunBuildConfig['loader'] {
  if (type === 'css') return { '.css': 'css' }
  return undefined
}

export async function buildWithBun(
  entry: string,
  type: 'js' | 'css',
  overrides?: Record<string, unknown>,
): Promise<BuildResult> {
  if (typeof Bun === 'undefined') {
    return { content: null, warnings: ['Bun is not available in this environment'] }
  }

  const config: BunBuildConfig = {
    entrypoints: [entry],
    minify: DEFAULT_MINIFY,
    loader: toBunLoader(type),
    target: 'browser',
  }
  if (overrides) {
    Object.assign(config, overrides)
  }
  const output = await Bun.build(config)
  if (!isBunBuildOutput(output)) {
    return { content: null, warnings: ['Unexpected Bun.build output'] }
  }

  const warnings = collectBuildWarnings(output.logs)
  if (!output.success) {
    return { content: null, warnings }
  }

  const artifact = pickEntryOutput(output.outputs)
  if (!artifact) return { content: null, warnings }
  return { content: await artifact.text(), warnings }
}

type FarmResource = {
  name: string
  bytes: number[]
}

type FarmCompiler = {
  compile: () => Promise<void>
  resourcesMap: () => Record<string, FarmResource>
}

type FarmConfig = {
  input?: { inline: string }
  assets?: { publicDir: string }
  minify?: boolean
  mode?: 'production' | 'development'
  output?: {
    format?: 'esm' | 'cjs'
    targetEnv?: string
  }
  plugins?: unknown[]
  [key: string]: unknown
}

type FarmModule = {
  createCompiler: (config: { config: FarmConfig }, logger?: unknown) => Promise<FarmCompiler>
}

async function loadFarmModule(): Promise<FarmModule> {
  const farmModuleId: '@farmfe/core' = '@farmfe/core'
  return await import(farmModuleId)
}

export async function buildWithFarm(
  entry: string,
  type: 'js' | 'css',
  overrides?: Record<string, unknown>,
): Promise<BuildResult> {
  try {
    const farm = await loadFarmModule()
    const config: FarmConfig = {
      input: { inline: entry },
      assets: { publicDir: '' },
      minify: true,
      mode: 'production',
      output: {
        format: 'esm',
        targetEnv: 'browser',
      },
    }
    if (type === 'css' && overrides?.plugins == null) {
      config.plugins = []
    }
    if (overrides) {
      Object.assign(config, overrides)
    }
    const compiler = await farm.createCompiler({ config })

    await compiler.compile()
    const resources = compiler.resourcesMap()
    const candidates: FarmResource[] = Object.values(resources)
    const preferredExt = type === 'css' ? '.css' : '.js'
    const preferred = candidates.find((resource) => resource.name.endsWith(preferredExt))
    const fallback = candidates.find((resource) => resource.name.endsWith('.css') || resource.name.endsWith('.js'))
    const selected = preferred ?? fallback
    if (!selected) return { content: null, warnings: [] }
    return { content: Buffer.from(selected.bytes).toString('utf-8'), warnings: [] }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: null, warnings: [message] }
  }
}
