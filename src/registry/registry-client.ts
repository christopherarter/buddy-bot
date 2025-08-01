import type { BuddyBotConfig, PackageMetadata, PackageUpdate } from '../types'
import type { Logger } from '../utils/logger'
import { PackageRegistryError } from '../types'
import { RegistryManager } from './registry-manager'

export class RegistryClient {
  private registryManager: RegistryManager

  constructor(
    private readonly projectPath: string,
    private readonly logger: Logger,
    private readonly config: BuddyBotConfig | undefined = undefined,
  ) {
    this.registryManager = new RegistryManager(projectPath)
  }

  /**
   * Get outdated packages using the modular driver system
   */
  async getOutdatedPackages(filter?: string): Promise<PackageUpdate[]> {
    this.logger.info('Checking for outdated packages...')

    try {
      const updates = await this.registryManager.getOutdatedPackages({
        includePrerelease: this.config?.packages?.includePrerelease,
        excludeMajor: this.config?.packages?.excludeMajor,
        ignoredPackages: this.config?.packages?.ignore,
      })

      // Apply filter if provided
      let filteredUpdates = updates
      if (filter) {
        const filterTerms = filter.split(' ')
        filteredUpdates = updates.filter(update =>
          filterTerms.some(term => update.name.includes(term))
        )
      }

      this.logger.success(`Found ${filteredUpdates.length} package updates`)
      return filteredUpdates
    }
    catch (error) {
      this.logger.error('Failed to check for outdated packages:', error)
      throw new PackageRegistryError(
        `Failed to check for outdated packages: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Get updates for specific packages
   */
  async getUpdatesForPackages(packageNames: string[]): Promise<PackageUpdate[]> {
    const filter = packageNames.join(' ')
    return this.getOutdatedPackages(filter)
  }

  /**
   * Get updates using glob patterns
   */
  async getUpdatesWithPattern(pattern: string): Promise<PackageUpdate[]> {
    return this.getOutdatedPackages(pattern)
  }

  /**
   * Get package metadata from registry
   */
  async getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      return await this.registryManager.getPackageMetadata(packageName)
    }
    catch (error) {
      this.logger.warn(`Failed to get metadata for ${packageName}:`, error)
      return undefined
    }
  }

  /**
   * Check if package exists in registry
   */
  async packageExists(packageName: string): Promise<boolean> {
    try {
      return await this.registryManager.packageExists(packageName)
    }
    catch {
      return false
    }
  }

  /**
   * Get latest version of a package
   */
  async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      return await this.registryManager.getLatestVersion(packageName, {
        includePrerelease: this.config?.packages?.includePrerelease,
      })
    }
    catch {
      return null
    }
  }

  /**
   * Filter updates by workspace (for monorepos)
   */
  async getUpdatesForWorkspace(workspaceName: string): Promise<PackageUpdate[]> {
    // Get all updates and filter by workspace
    const allUpdates = await this.getOutdatedPackages()
    return allUpdates.filter(update => 
      update.file?.includes(workspaceName) || 
      update.file?.startsWith(`${workspaceName}/`)
    )
  }

  /**
   * Search packages using registry APIs
   */
  async searchPackages(query: string, limit = 10): Promise<Array<{
    name: string
    version: string
    description?: string
    keywords?: string[]
  }>> {
    try {
      const results = await this.registryManager.searchPackages(query, limit)
      // Remove registry field for backward compatibility
      return results.map(({ registry, ...rest }) => rest)
    }
    catch (error) {
      this.logger.warn(`Failed to search packages:`, error)
      return []
    }
  }
}