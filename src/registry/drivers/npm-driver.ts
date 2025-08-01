import type { PackageMetadata } from '../../types'
import type { PackageQueryResult, RegistryDriver, RegistryDriverOptions } from './types'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

interface BunOutdatedResult {
  name: string
  current: string
  update: string
  latest: string
  workspace?: string
  file?: string
}

export class NpmDriver implements RegistryDriver {
  name = 'npm'

  async canHandle(projectPath: string): Promise<boolean> {
    const packageJsonPath = path.join(projectPath, 'package.json')
    return fs.existsSync(packageJsonPath)
  }

  getManifestFiles(): string[] {
    return ['package.json']
  }

  async getOutdatedPackages(options: RegistryDriverOptions): Promise<PackageQueryResult[]> {
    const results: PackageQueryResult[] = []
    
    // Get updates from bun outdated
    const bunResults = await this.runBunOutdated(options.projectPath)
    
    // Get updates from package.json comparison
    const packageJsonResults = await this.getPackageJsonOutdated(options)
    
    // Merge results
    const allResults = new Map<string, BunOutdatedResult>()
    
    for (const result of bunResults) {
      allResults.set(result.name, result)
    }
    
    for (const result of packageJsonResults) {
      if (!allResults.has(result.name)) {
        allResults.set(result.name, result)
      }
    }
    
    for (const result of allResults.values()) {
      // Skip ignored packages
      if (options.ignoredPackages?.includes(result.name)) {
        continue
      }
      
      results.push({
        name: result.name,
        currentVersion: result.current,
        latestVersion: result.latest,
        file: result.file || 'package.json',
      })
    }
    
    return results
  }

  async getPackageMetadata(packageName: string): Promise<PackageMetadata | undefined> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
      if (!response.ok) {
        return undefined
      }

      const data = await response.json() as any
      const latestVersion = data['dist-tags']?.latest || Object.keys(data.versions || {}).pop()
      const latestData = data.versions?.[latestVersion] || {}

      return {
        name: data.name,
        description: data.description || latestData.description,
        repository: typeof data.repository === 'string' ? data.repository : data.repository?.url,
        homepage: data.homepage || latestData.homepage,
        license: data.license || latestData.license,
        author: typeof data.author === 'string' ? data.author : data.author?.name,
        keywords: data.keywords || latestData.keywords,
        latestVersion,
        versions: Object.keys(data.versions || {}),
        weeklyDownloads: undefined, // Would need separate API call
        dependencies: latestData.dependencies,
        devDependencies: latestData.devDependencies,
        peerDependencies: latestData.peerDependencies,
      }
    }
    catch (error) {
      console.warn(`Failed to get metadata for ${packageName}:`, error)
      return undefined
    }
  }

  async packageExists(packageName: string): Promise<boolean> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
      return response.ok
    }
    catch {
      return false
    }
  }

  async getLatestVersion(packageName: string, options?: RegistryDriverOptions): Promise<string | null> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
      if (!response.ok) {
        return null
      }

      const data = await response.json() as any
      const versions = Object.keys(data.versions || {})

      if (versions.length === 0) {
        return null
      }

      // Filter versions based on prerelease setting
      const includePrerelease = options?.includePrerelease ?? false
      let filteredVersions = versions

      if (!includePrerelease) {
        filteredVersions = versions.filter((version) => {
          return !this.isPrerelease(version)
        })
      }

      if (filteredVersions.length === 0) {
        return null
      }

      // Sort versions using semver and get the latest
      const sortedVersions = filteredVersions.sort((a, b) => {
        try {
          return Bun.semver.order(b, a) // Reverse order for descending
        }
        catch {
          return 0
        }
      })

      return sortedVersions[0] || null
    }
    catch (error) {
      console.warn(`Failed to get npm version for ${packageName}:`, error)
      return null
    }
  }

  async getAvailableVersions(packageName: string): Promise<string[]> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
      if (!response.ok) {
        return []
      }

      const data = await response.json() as any
      return Object.keys(data.versions || {})
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
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodedQuery}&size=${limit}`

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json() as any

      return data.objects?.map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
        keywords: obj.package.keywords,
      })) || []
    }
    catch (error) {
      console.warn(`Failed to search packages via registry API:`, error)
      return []
    }
  }

  parseVersionConstraint(constraint: string): string | null {
    // Handle workspace: protocol
    if (constraint.startsWith('workspace:')) {
      return null
    }

    // Remove common range indicators (handle multi-character operators like >=, <=)
    return constraint.replace(/^[\^~>=<]+/, '').trim()
  }

  private isPrerelease(version: string): boolean {
    const prereleasePattern = /-(?:alpha|beta|rc|dev|canary|next|experimental|snapshot|nightly)/i
    return prereleasePattern.test(version)
  }

  private async runBunOutdated(projectPath: string): Promise<BunOutdatedResult[]> {
    try {
      const output = await this.runCommand('bun', ['outdated'], projectPath)
      return this.parseBunOutdatedOutput(output)
    }
    catch (error) {
      console.error('Failed to run bun outdated:', error)
      return []
    }
  }

  private parseBunOutdatedOutput(output: string): BunOutdatedResult[] {
    const results: BunOutdatedResult[] = []

    // Remove ANSI color codes
    const ansiEscape = `${String.fromCharCode(27)}[`
    const cleanOutput = output.replace(new RegExp(`${ansiEscape}[0-9;]*m`, 'g'), '')
    const cleanLines = cleanOutput.split('\n').filter(line => line.trim())

    // Skip header lines and parse table format
    let dataStarted = false
    for (const line of cleanLines) {
      if (line.includes('Package') && line.includes('Current') && line.includes('Update')) {
        dataStarted = true
        continue
      }

      if (!dataStarted || !line.trim()) continue

      // Skip lines that are just separators
      if (line.match(/^[│├─┼┤└┴┘┌┬┐|\-\s]+$/)) continue

      // Parse table format - handle both | and │ separators
      let parts: string[]
      if (line.includes('│')) {
        parts = line.split('│').map(part => part.trim())
      }
      else {
        parts = line.split('|').map(part => part.trim())
      }

      if (parts.length >= 4) {
        let name = parts[1]?.trim() || ''
        const current = parts[2]?.trim() || ''
        const update = parts[3]?.trim() || ''
        const latest = parts[4]?.trim() || ''
        const workspace = parts.length >= 6 ? parts[5]?.trim() : undefined

        // Clean package name
        name = name.replace(/\s*\(dev\)$/, '').replace(/\s*\(peer\)$/, '').replace(/\s*\(optional\)$/, '')

        if (name && current && latest && name !== 'Package') {
          const result: BunOutdatedResult = {
            name,
            current,
            update,
            latest,
          }

          if (workspace && workspace !== 'Workspace') {
            result.workspace = workspace
          }

          results.push(result)
        }
      }
    }

    return results
  }

  private async getPackageJsonOutdated(options: RegistryDriverOptions): Promise<BunOutdatedResult[]> {
    try {
      const packageJsonPath = path.join(options.projectPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        return []
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
      }

      const results: BunOutdatedResult[] = []

      for (const [packageName, packageVersion] of Object.entries(allDeps)) {
        if (!packageVersion || typeof packageVersion !== 'string') continue

        // Skip ignored packages
        if (options.ignoredPackages?.includes(packageName)) {
          continue
        }

        // Get the actual version from package.json
        const cleanVersion = this.parseVersionConstraint(packageVersion)
        if (!cleanVersion) {
          continue
        }

        // Get latest version from registry
        const latestVersion = await this.getLatestVersion(packageName, options)
        if (!latestVersion) continue

        // Check if package.json version is older than latest
        if (Bun.semver.order(cleanVersion, latestVersion) < 0) {
          results.push({
            name: packageName,
            current: cleanVersion,
            update: latestVersion,
            latest: latestVersion,
          })
        }
      }

      return results
    }
    catch (error) {
      console.warn('Failed to check package.json versions:', error)
      return []
    }
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