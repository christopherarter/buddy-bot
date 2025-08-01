# Registry Drivers

This directory contains the modular registry driver system for buddy-bot. Each driver handles a specific package registry (npm, Composer, etc.).

## Architecture

The registry system uses a driver-based architecture where:
- Each driver implements the `RegistryDriver` interface
- Drivers are automatically detected based on project files
- Multiple drivers can be active in the same project (e.g., for projects using both npm and Composer)

## Built-in Drivers

### NPM Driver (`npm-driver.ts`)
- Handles: `package.json` files
- Registry: npmjs.org
- Commands: Uses `bun outdated` for efficiency

### Composer Driver (`composer-driver.ts`)
- Handles: `composer.json` files
- Registry: packagist.org
- Commands: Uses `composer outdated`

## Creating a Custom Driver

To add support for a new package registry:

1. Create a new file in this directory (e.g., `cargo-driver.ts`)
2. Implement the `RegistryDriver` interface
3. Register your driver in the `RegistryManager`

### Example Custom Driver

```typescript
import type { RegistryDriver } from './types'

export class CargoDriver implements RegistryDriver {
  name = 'cargo'

  async canHandle(projectPath: string): Promise<boolean> {
    // Check for Cargo.toml
    return fs.existsSync(path.join(projectPath, 'Cargo.toml'))
  }

  getManifestFiles(): string[] {
    return ['Cargo.toml']
  }

  // Implement other required methods...
}
```

### Registering a Custom Driver

```typescript
import { RegistryManager } from '../registry-manager'
import { CargoDriver } from './drivers/cargo-driver'

const manager = new RegistryManager(projectPath)
manager.registerDriver(CargoDriver)
```

## Driver Interface

Each driver must implement:

- `canHandle(projectPath)`: Detect if this driver applies to the project
- `getOutdatedPackages(options)`: Get list of outdated packages
- `getPackageMetadata(packageName)`: Fetch package details from registry
- `packageExists(packageName)`: Check if package exists
- `getLatestVersion(packageName, options)`: Get latest version
- `getAvailableVersions(packageName)`: Get all available versions
- `searchPackages(query, limit)`: Search the registry
- `getManifestFiles()`: Return manifest filenames this driver handles
- `parseVersionConstraint(constraint)`: Parse version from constraint string

## Testing

Each driver should have corresponding tests. See the test files for examples.
