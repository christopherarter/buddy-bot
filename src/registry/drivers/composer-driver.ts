import type { PackageMetadata } from '../../types'
import type { PackageQueryResult, RegistryDriver, RegistryDriverOptions } from './types'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export class ComposerDriver implements RegistryDriver {
  name = 'composer'

  async canHandle(projectPath: string): Promise<boolean> {
    const composerJsonPath = path.join(projectPath, 'composer.json')
    if (!fs.existsSync(composerJsonPath)) {
      return false
    }
    
    // Also check if composer is available
    try {
      await this.runCommand('composer', ['--version'], projectPath)
      return true
    }
    catch {
      return false
    }
  }

  getManifestFiles(): string[] {
    return ['composer.json']
  }

  async getOutdatedPackages(options: RegistryDriverOptions): Promise<PackageQueryResult[]> {
    const results: PackageQueryResult[] = []
    
    try {
      // Read composer.json to get current constraints
      const composerJsonPath = path.join(options.projectPath, 'composer.json')
      const composerJsonContent = fs.readFileSync(composerJsonPath, 'utf8')
      const composerJsonData = JSON.parse(composerJsonContent)
      
      // Run composer outdated to get available updates
      const composerOutput = await this.runCommand('composer', ['outdated', '--format=json'], options.projectPath)
      const composerData = JSON.parse(composerOutput)
      
      if (composerData.installed) {
        for (const pkg of composerData.installed) {
          if (!pkg.name || !pkg.version || !pkg.latest) continue
          
          // Get the version constraint from composer.json
          const requireConstraint = composerJsonData.require?.[pkg.name]
          const requireDevConstraint = composerJsonData['require-dev']?.[pkg.name]
          const constraint = requireConstraint || requireDevConstraint
          
          if (!constraint) continue // Skip packages not in composer.json
          
          // Skip ignored packages
          if (options.ignoredPackages?.includes(pkg.name)) {
            continue
          }
          
          // Determine dependency type
          const dependencyType = composerJsonData['require-dev']?.[pkg.name] ? 'require-dev' : 'require'
          
          // Extract base version from constraint
          const constraintBaseVersion = this.parseVersionConstraint(constraint)
          if (!constraintBaseVersion) continue
          
          // Get available versions
          let availableVersions: string[] = []
          try {
            const showOutput = await this.runCommand('composer', ['show', pkg.name, '--available', '--format=json'], options.projectPath)
            const showData = JSON.parse(showOutput)
            if (showData.versions) {
              availableVersions = showData.versions
            }
          }
          catch {
            availableVersions = [pkg.latest]
          }
          
          results.push({
            name: pkg.name,
            currentVersion: constraintBaseVersion,
            latestVersion: pkg.latest,
            availableVersions,
            file: 'composer.json',
            dependencyType,
          })
        }
      }
      
      return results
    }
    catch (error) {
      console.warn('Failed to check for outdated Composer packages:', error)
      return []
    }
  }

  async getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)
      if (!response.ok) {
        return undefined
      }

      const data = await response.json() as any
      const packageData = data.package

      if (!packageData) {
        return undefined
      }

      // Get the latest version info
      const versions = Object.keys(packageData.versions || {})
      const latestVersion = versions.find(v => !v.includes('dev') && !v.includes('alpha') && !v.includes('beta')) || versions[0]
      const versionData = packageData.versions[latestVersion] || {}

      return {
        name: packageData.name,
        description: versionData.description,
        repository: versionData.source?.url || versionData.homepage,
        homepage: versionData.homepage,
        license: Array.isArray(versionData.license) ? versionData.license.join(', ') : versionData.license,
        author: versionData.authors?.[0]?.name,
        keywords: versionData.keywords,
        latestVersion,
        versions,
        weeklyDownloads: packageData.downloads?.monthly, // Packagist provides monthly, not weekly
        dependencies: versionData.require,
        devDependencies: versionData['require-dev'],
      }
    }
    catch (error) {
      console.warn(`Failed to get Composer metadata for ${packageName}:`, error)
      return undefined
    }
  }

  async packageExists(packageName: string): Promise<boolean> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)
      return response.ok
    }
    catch {
      return false
    }
  }

  async getLatestVersion(packageName: string, options?: RegistryDriverOptions): Promise<string | null> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)
      if (!response.ok) {
        return null
      }

      const data = await response.json() as any
      const packageData = data.package

      if (!packageData?.versions) {
        return null
      }

      // Get stable versions only
      const versions = Object.keys(packageData.versions)
      let filteredVersions = versions
      
      if (!options?.includePrerelease) {
        filteredVersions = versions.filter(v =>
          !v.includes('dev')
          && !v.includes('alpha')
          && !v.includes('beta')
          && !v.includes('rc'),
        )
      }

      if (filteredVersions.length === 0) {
        return versions[0] || null
      }

      // Sort versions and get the latest
      const sortedVersions = filteredVersions.sort((a, b) => {
        try {
          if (typeof Bun !== 'undefined' && Bun.semver) {
            return Bun.semver.order(a, b)
          }
          return a.localeCompare(b, undefined, { numeric: true })
        }
        catch {
          return a.localeCompare(b)
        }
      })

      return sortedVersions[sortedVersions.length - 1] || null
    }
    catch (error) {
      console.warn(`Failed to get latest Composer version for ${packageName}:`, error)
      return null
    }
  }

  async getAvailableVersions(packageName: string): Promise<string[]> {
    try {
      const response = await fetch(`https://packagist.org/packages/${packageName}.json`)
      if (!response.ok) {
        return []
      }

      const data = await response.json() as any
      const packageData = data.package

      if (!packageData?.versions) {
        return []
      }

      return Object.keys(packageData.versions)
    }
    catch {
      return []
    }
  }

  async searchPackages(query: string, limit = 10): Promise<Array<{
    name: string
    version: string
    description?: string
    keywords?: string[]
  }>> {
    try {
      const encodedQuery = encodeURIComponent(query)
      const url = `https://packagist.org/search.json?q=${encodedQuery}&per_page=${limit}`

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as any

      return data.results?.map((result: any) => ({
        name: result.name,
        version: '', // Packagist search doesn't return version in search results
        description: result.description,
        keywords: [], // Not provided in search results
      })) || []
    }
    catch (error) {
      console.warn(`Failed to search packages via Packagist API:`, error)
      return []
    }
  }

  parseVersionConstraint(constraint: string): string | null {
    const match = constraint.match(/^[\^~>=<]*(\d+(?:\.\d+)*(?:\.\d+)?)/)
    if (match) {
      return match[1]
    }
    return null
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: 'pipe',
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        }
        else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`))
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  }
}