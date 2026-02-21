# Getting Started - Wovly Desktop Development

## Prerequisites

- Node.js 20+ and npm 10+
- macOS (for full feature development)
- Git

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd wovlyhome

# Install dependencies
cd apps/desktop
npm install

# Install UI dependencies
cd ../ui
npm install
```

## Development Workflow

### Running the App

```bash
# From apps/desktop directory
npm run dev
```

This starts Electron in development mode with hot reloading.

### Code Quality Commands

```bash
# Type checking
npm run type-check

# Linting
npm run lint              # Check for issues
npm run lint:fix          # Auto-fix issues

# Formatting
npm run format            # Format all files
npm run format:check      # Check formatting

# Testing
npm test                  # Run all tests
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate coverage report
npm run test:ui           # Open Vitest UI
```

### Pre-Commit Checklist

The following checks run automatically on `git commit`:
- ✅ ESLint on changed TypeScript files
- ✅ Prettier formatting on changed files
- ✅ Vitest on related test files

**Manual checklist before committing**:
1. `npm run type-check` passes
2. `npm run lint` has 0 warnings
3. `npm test` all tests pass
4. Coverage > 80% for new code
5. No `console.log` statements
6. No `any` types
7. Error handling implemented
8. Logging added for key operations

### Creating a New Service

1. **Define Interface** (`src/types/services.ts`):
```typescript
export interface IMyService {
  doSomething(input: string): Promise<Result>;
}
```

2. **Implement Service** (`src/services/my-service.ts`):
```typescript
import { injectable, inject } from 'inversify';
import { IMyService } from '../types/services';
import { logger } from '../utils/logger';

@injectable()
export class MyService implements IMyService {
  constructor(
    @inject('IMyRepository') private repository: IMyRepository
  ) {}

  async doSomething(input: string): Promise<Result> {
    try {
      logger.info('MyService.doSomething', { input });
      const result = await this.repository.fetch(input);
      return result;
    } catch (error) {
      logger.error('MyService.doSomething failed', { error, input });
      throw new ServiceError('Operation failed', { cause: error });
    }
  }
}
```

3. **Register in DI Container** (`src/di/container.ts`):
```typescript
container.bind<IMyService>('IMyService').to(MyService);
```

4. **Write Tests** (`tests/unit/services/my-service.test.ts`):
```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyService } from '../../../src/services/my-service';

describe('MyService', () => {
  it('should do something', async () => {
    const mockRepository = { fetch: vi.fn().mockResolvedValue('result') };
    const service = new MyService(mockRepository);

    const result = await service.doSomething('input');

    expect(result).toBe('result');
    expect(mockRepository.fetch).toHaveBeenCalledWith('input');
  });
});
```

### Creating a New IPC Handler

1. **Define Handler** (`src/ipc/handlers/my-handler.ts`):
```typescript
import { ipcMain } from 'electron';
import { container } from '../../di/container';
import { IMyService } from '../../types/services';
import { logger } from '../../utils/logger';

export function registerMyHandler(): void {
  ipcMain.handle('my:operation', async (_event, input: unknown) => {
    try {
      const service = container.get<IMyService>('IMyService');
      const result = await service.doSomething(String(input));
      return { success: true, data: result };
    } catch (error) {
      logger.error('IPC handler my:operation failed', { error });
      return { success: false, error: error.message };
    }
  });
}
```

2. **Register Handler** (`src/ipc/index.ts`):
```typescript
import { registerMyHandler } from './handlers/my-handler';

export function registerAllHandlers(): void {
  registerMyHandler();
  // ... other handlers
}
```

3. **Add Preload Binding** (`preload.js`):
```javascript
my: {
  operation: (input) => ipcRenderer.invoke('my:operation', input)
}
```

## File Organization Rules

### File Size Limits
- **Maximum 500 lines** per file
- If a file exceeds 500 lines, split it:
  - Extract helper functions to `utils/`
  - Split by responsibility into multiple files
  - Use barrel exports (`index.ts`) to maintain API

### Function Size Limits
- **Maximum 50 lines** per function
- If a function exceeds 50 lines, refactor:
  - Extract sub-operations into helper functions
  - Use composition over long procedures
  - Consider if the function has too many responsibilities

### Naming Conventions
- **Files**: kebab-case (`my-service.ts`)
- **Classes**: PascalCase (`MyService`)
- **Interfaces**: PascalCase with `I` prefix (`IMyService`)
- **Functions**: camelCase (`doSomething`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Types**: PascalCase (`MyType`)

## Testing Guidelines

### Unit Tests
- Test individual functions and classes in isolation
- Mock all dependencies
- Focus on business logic
- Location: `tests/unit/`

### Integration Tests
- Test interaction between components
- Use real dependencies when possible
- Test repository → storage interactions
- Location: `tests/integration/`

### E2E Tests
- Test complete user workflows
- Use real Electron instance
- Minimal mocking
- Location: `tests/e2e/`

### Test Naming
```typescript
describe('ServiceName', () => {
  describe('methodName', () => {
    it('should do X when Y', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = service.methodName(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

## Error Handling

### Custom Error Classes
```typescript
export class ServiceError extends Error {
  constructor(message: string, public context?: Record<string, unknown>) {
    super(message);
    this.name = 'ServiceError';
  }
}
```

### Error Logging
```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,
    context: { userId, operation: 'risky' }
  });
  throw new ServiceError('User-friendly message', { cause: error });
}
```

## Logging

### Log Levels
- `error`: Errors that require attention
- `warn`: Warnings that don't stop execution
- `info`: Important information (service start, key operations)
- `debug`: Detailed debugging information (not in production)

### Structured Logging
```typescript
logger.info('User action', {
  action: 'login',
  userId: user.id,
  timestamp: new Date().toISOString()
});
```

## Common Issues

### TypeScript Errors
```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
npm run type-check
```

### Test Failures
```bash
# Run specific test
npm test -- my-service.test.ts

# Run with verbose output
npm test -- --reporter=verbose

# Update snapshots
npm test -- -u
```

### Linting Issues
```bash
# Auto-fix most issues
npm run lint:fix

# Check specific file
npx eslint src/services/my-service.ts
```

## Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [InversifyJS Guide](https://github.com/inversify/InversifyJS)
- [Winston Logger](https://github.com/winstonjs/winston)

## Getting Help

- Check existing documentation in `/docs`
- Review CLAUDE.md for coding standards
- Search existing code for similar patterns
- Ask team members or create an issue
