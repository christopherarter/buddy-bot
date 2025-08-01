import type { PackageMetadata, PackageUpdate } from '../../types'

export interface RegistryDriverOptions {
  projectPath: string
  includePrerelease?: boolean
  excludeMajor?: boolean
  ignoredPackages?: string[]
}

export interface PackageQueryResult {
  name: string
  currentVersion: string
  latestVersion: string
  availableVersions?: string[]
  file?: string
  dependencyType?: string
}

export interface RegistryDriver {
  name: string
  
  /**
   * Check if this driver can handle the current project
   */
  canHandle(projectPath: string): Promise<boolean>
  
  /**
   * Get all outdated packages
   */
  getOutdatedPackages(options: RegistryDriverOptions): Promise<PackageQueryResult[]>
  
  /**
   * Get metadata for a specific package
   */
  getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined>
  
  /**
   * Check if a package exists in the registry
   */
  packageExists(packageName: string): Promise<boolean>
  
  /**
   * Get the latest version of a package
   */
  getLatestVersion(packageName: string, options?: RegistryDriverOptions): Promise<string | null>
  
  /**
   * Get all available versions of a package
   */
  getAvailableVersions(packageName: string): Promise<string[]>
  
  /**
   * Search for packages by query
   */
  searchPackages(query: string, limit?: number): Promise<Array<{
    name: string
    version: string
    description?: string
    keywords?: string[]
  }>>
  
  /**
   * Get the manifest file name(s) this driver handles
   */
  getManifestFiles(): string[]
  
  /**
   * Parse version from version range/constraint
   */
  parseVersionConstraint(constraint: string): string | null
}

export interface RegistryDriverConstructor {
  new(): RegistryDriver
}