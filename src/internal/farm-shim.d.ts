declare module '@farmfe/core' {
  export interface Compiler {
    compile(): Promise<void>
    resourcesMap(): Record<string, { name: string; bytes: number[] }>
  }

  export function createCompiler(
    config: { config: Record<string, unknown> },
    logger?: unknown,
  ): Promise<Compiler>
}
