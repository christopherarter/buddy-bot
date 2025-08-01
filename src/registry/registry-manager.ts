import type { PackageMetadata, PackageUpdate } from '../types'
import type { RegistryDriver, RegistryDriverConstructor, RegistryDriverOptions } from './drivers/types'
import { NpmDriver } from './drivers/npm-driver'
import { ComposerDriver } from './drivers/composer-driver'
import { getUpdateType } from '../utils/helpers'
import path from 'node:path'

export class RegistryManager {
  private drivers: RegistryDriver[] = []
  private activeDrivers: Map<string, RegistryDriver> = new Map()

  constructor(private projectPath: string) {
    // Register built-in drivers
    this.registerDriver(NpmDriver)
    this.registerDriver(ComposerDriver)
  }

  /**
   * Register a new registry driver
   */
  registerDriver(driverClass: RegistryDriverConstructor): void {
    const driver = new driverClass()
    this.drivers.push(driver)
  }

  /**
   * Get all registered drivers
   */
  getDrivers(): RegistryDriver[] {
    return [...this.drivers]
  }

  /**
   * Detect which drivers can handle the current project
   */
  async detectActiveDrivers(): Promise<RegistryDriver[]> {
    this.activeDrivers.clear()
    
    for (const driver of this.drivers) {
      if (await driver.canHandle(this.projectPath)) {
        this.activeDrivers.set(driver.name, driver)
      }
    }
    
    return Array.from(this.activeDrivers.values())
  }

  /**
   * Get a specific driver by name
   */
  getDriver(name: string): RegistryDriver | undefined {
    return this.activeDrivers.get(name)
  }

  /**
   * Get all outdated packages from all active drivers
   */
  async getOutdatedPackages(options: Partial<RegistryDriverOptions> = {}): Promise<PackageUpdate[]> {
    const activeDrivers = await this.detectActiveDrivers()
    const allUpdates: PackageUpdate[] = []
    
    const driverOptions: RegistryDriverOptions = {
      projectPath: this.projectPath,
      ...options,
    }
    
    for (const driver of activeDrivers) {
      try {
        const queryResults = await driver.getOutdatedPackages(driverOptions)
        
        // Convert driver results to PackageUpdate format
        for (const result of queryResults) {
          const metadata = await driver.getPackageMetadata(result.name)
          const updateType = getUpdateType(result.currentVersion, result.latestVersion)
          
          // Skip major updates if configured
          if (options.excludeMajor && updateType === 'major') {
            continue
          }
          
          allUpdates.push({
            name: result.name,
            currentVersion: result.currentVersion,
            newVersion: result.latestVersion,
            updateType,
            dependencyType: result.dependencyType || 'dependencies',
            file: result.file || driver.getManifestFiles()[0],
            metadata,
            releaseNotesUrl: this.getReleaseNotesUrl(result.name, metadata),
            changelogUrl: this.getChangelogUrl(result.name, metadata),
            homepage: metadata?.homepage,
          })
        }
      }
      catch (error) {
        console.warn(`Failed to get updates from ${driver.name} driver:`, error)
      }
    }
    
    return allUpdates
  }

  /**
   * Get metadata for a package from the appropriate driver
   */
  async getPackageMetadata(packageName: string, driverName?: string): Promise<PackageMetadata | undefined> {
    if (driverName) {
      const driver = this.activeDrivers.get(driverName)
      if (driver) {
        return driver.getPackageMetadata(packageName)
      }
    }
    
    // Try all drivers until one returns metadata
    for (const driver of this.activeDrivers.values()) {
      const metadata = await driver.getPackageMetadata(packageName)
      if (metadata) {
        return metadata
      }
    }
    
    return undefined
  }

  /**
   * Check if a package exists in any registry
   */
  async packageExists(packageName: string): Promise<boolean> {
    for (const driver of this.activeDrivers.values()) {
      if (await driver.packageExists(packageName)) {
        return true
      }
    }
    return false
  }

  /**
   * Get latest version of a package
   */
  async getLatestVersion(packageName: string, options?: Partial<RegistryDriverOptions>): Promise<string | null> {
    const driverOptions: RegistryDriverOptions = {
      projectPath: this.projectPath,
      ...options,
    }
    
    for (const driver of this.activeDrivers.values()) {
      const version = await driver.getLatestVersion(packageName, driverOptions)
      if (version) {
        return version
      }
    }
    
    return null
  }

  /**
   * Search for packages across all registries
   */
  async searchPackages(query: string, limit = 10): Promise<Array<{
    name: string
    version: string
    description?: string
    keywords?: string[]
    registry: string
  }>> {
    const results: Array<{
      name: string
      version: string
      description?: string
      keywords?: string[]
      registry: string
    }> = []
    
    for (const driver of this.activeDrivers.values()) {
      try {
        const driverResults = await driver.searchPackages(query, limit)
        results.push(...driverResults.map(result => ({
          ...result,
          registry: driver.name,
        })))
      }
      catch (error) {
        console.warn(`Failed to search packages in ${driver.name}:`, error)
      }
    }
    
    return results
  }

  /**
   * Generate release notes URL based on package metadata
   */
  private getReleaseNotesUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository) return undefined

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/releases`
    }

    return undefined
  }

  /**
   * Generate changelog URL based on package metadata
   */
  private getChangelogUrl(packageName: string, metadata?: PackageMetadata): string | undefined {
    if (!metadata?.repository) return undefined

    // Extract GitHub repo URL
    const repoMatch = metadata.repository.match(/github\.com[/:]([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repoPath = repoMatch[1].replace('.git', '')
      return `https://github.com/${repoPath}/blob/main/CHANGELOG.md`
    }

    return undefined
  }
}