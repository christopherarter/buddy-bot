export * from './types'
export * from './npm-driver'
export * from './composer-driver'

// Re-export for convenience
import { NpmDriver } from './npm-driver'
import { ComposerDriver } from './composer-driver'
import type { RegistryDriverConstructor } from './types'

export const BUILT_IN_DRIVERS: RegistryDriverConstructor[] = [
  NpmDriver,
  ComposerDriver,
]