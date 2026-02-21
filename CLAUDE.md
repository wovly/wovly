# Wovly Development Guidelines

**CRITICAL**: All AI assistants working on this codebase must follow these guidelines strictly.

## 🏗️ Architecture Principles

### 1. File Size Limits - STRICTLY ENFORCED
- ❌ **NEVER create files > 500 lines**
- ⚠️ Files 300-500 lines require justification
- ✅ Ideal file size: 100-300 lines
- 🚨 **main.js is currently 17K+ lines - DO NOT ADD TO IT**
  - Extract logic into services before adding features
  - Any changes to main.js must reduce its line count

### 2. TypeScript Everywhere
```typescript
// ✅ REQUIRED for all new code
export class WebScraperService {
  async scrapeMessages(config: SiteConfig): Promise<ScrapeResult> {
    // Implementation
  }
}

// ❌ FORBIDDEN - No new JavaScript files
function scrapeMessages(config) {
  // This is not allowed
}
```

**Rules:**
- All new files must be `.ts` or `.tsx`
- Use strict mode: `"strict": true`
- No `any` types without explicit justification
- Define interfaces for all data structures
- Use enums for constants

### 3. Layered Architecture - MANDATORY

```
User Interface (UI)
       ↓
IPC Handlers (thin layer, validation only)
       ↓
Services (business logic)
       ↓
Repositories/Managers (data access)
       ↓
Storage/External APIs
```

**Example:**
```typescript
// ✅ CORRECT - Layered
// src/ipc/handlers/webscraper.handlers.ts
export const launchOAuthLogin = async (event, params: OAuthParams) => {
  const service = container.get<WebScraperService>(TYPES.WebScraperService);
  return await service.launchOAuthLogin(params);
};

// src/services/WebScraperService.ts
@injectable()
export class WebScraperService {
  constructor(
    @inject(TYPES.OAuthHandler) private oauth: IOAuthHandler,
    @inject(TYPES.ConfigManager) private config: IConfigManager
  ) {}

  async launchOAuthLogin(params: OAuthParams): Promise<OAuthResult> {
    // Business logic here
  }
}

// ❌ WRONG - IPC handler with business logic
ipcMain.handle('oauth', async (event, params) => {
  const OAuthHandler = require('./oauth');
  const handler = new OAuthHandler();
  return handler.login(params); // Too much logic in IPC layer
});
```

### 4. Dependency Injection - REQUIRED

**Use InversifyJS for all new services:**

```typescript
// src/di/types.ts
export const TYPES = {
  WebScraperService: Symbol.for('WebScraperService'),
  OAuthHandler: Symbol.for('OAuthHandler'),
  Logger: Symbol.for('Logger'),
};

// src/di/container.ts
import { Container } from 'inversify';

const container = new Container();
container.bind<IWebScraperService>(TYPES.WebScraperService).to(WebScraperService);

// Usage in services
@injectable()
export class WebScraperService {
  constructor(
    @inject(TYPES.Logger) private logger: ILogger
  ) {}
}
```

**Never use:**
```typescript
// ❌ FORBIDDEN - Direct requires in business logic
const logger = require('./logger');
const config = require('./config');
```

## 📁 File Organization Rules

### Directory Structure - MUST FOLLOW

```
apps/desktop/
├── src/
│   ├── main.ts                    # Entry point (< 100 lines)
│   ├── ipc/
│   │   ├── handlers/              # One file per domain
│   │   │   ├── auth.handlers.ts
│   │   │   ├── webscraper.handlers.ts
│   │   │   └── index.ts
│   │   └── registry.ts            # IPC registration
│   ├── services/                  # Business logic
│   │   ├── AuthService.ts
│   │   ├── WebScraperService.ts
│   │   └── index.ts
│   ├── repositories/              # Data access
│   │   ├── UserRepository.ts
│   │   └── index.ts
│   ├── models/                    # Data models
│   │   └── User.ts
│   ├── types/                     # Type definitions
│   │   ├── common.ts
│   │   └── index.ts
│   ├── config/                    # Configuration
│   │   ├── app.config.ts
│   │   └── env.config.ts
│   ├── utils/                     # Pure utility functions
│   │   └── helpers.ts
│   ├── middleware/                # Error handling, validation
│   │   └── errorHandler.ts
│   └── di/                        # Dependency injection
│       ├── container.ts
│       └── types.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/                          # All documentation here
└── scripts/                       # Build/deploy scripts
```

**Rules:**
- ❌ **NO test files in src/** - Use `tests/` directory
- ❌ **NO business logic in main.ts** - Only app bootstrap
- ❌ **NO utils dumping ground** - Create specific modules
- ✅ Co-located `__tests__` folders are acceptable for unit tests

### File Naming Conventions

```
✅ CORRECT:
- PascalCase for classes: WebScraperService.ts
- camelCase for functions: parseTimestamp.ts
- kebab-case for components: oauth-login-modal.tsx
- .spec.ts for tests: WebScraperService.spec.ts
- .types.ts for pure types: webscraper.types.ts

❌ WRONG:
- webscraper_service.ts (snake_case)
- WebScraperservice.ts (inconsistent)
- test-webscraper.ts (unclear test file)
```

## 🧪 Testing Requirements - MANDATORY

### Every new feature MUST include:

1. **Unit tests** (80%+ coverage for business logic)
2. **Integration tests** (for IPC handlers)
3. **Type tests** (for TypeScript types)

```typescript
// ✅ REQUIRED test structure
describe('WebScraperService', () => {
  let service: WebScraperService;
  let mockOAuthHandler: jest.Mocked<IOAuthHandler>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockOAuthHandler = createMock<IOAuthHandler>();
    mockLogger = createMock<ILogger>();
    service = new WebScraperService(mockOAuthHandler, mockLogger);
  });

  describe('launchOAuthLogin', () => {
    it('should successfully launch OAuth login', async () => {
      // Arrange
      const params = { url: 'https://example.com', siteName: 'Example' };
      mockOAuthHandler.launchManualLogin.mockResolvedValue({ success: true });

      // Act
      const result = await service.launchOAuthLogin(params);

      // Assert
      expect(result.success).toBe(true);
      expect(mockOAuthHandler.launchManualLogin).toHaveBeenCalledWith(params);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Launching OAuth login',
        expect.objectContaining({ params })
      );
    });

    it('should handle OAuth login failure', async () => {
      // Test error cases
    });
  });
});
```

**Test file location:**
```
src/services/WebScraperService.ts
src/services/__tests__/WebScraperService.spec.ts
```

### Before Committing - RUN:
```bash
npm run type-check   # TypeScript compilation
npm run lint         # ESLint checks
npm run test         # All tests pass
npm run test:coverage # Coverage > 80%
```

## 🎯 Error Handling Standards

### Use Custom Error Classes

```typescript
// src/errors/AppError.ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Domain-specific errors
export class OAuthSessionExpiredError extends AppError {
  constructor(siteId: string) {
    super(
      `OAuth session expired for site: ${siteId}`,
      'OAUTH_SESSION_EXPIRED',
      401,
      true,
      { siteId }
    );
  }
}

export class WebScraperError extends AppError {
  constructor(message: string, siteId: string, cause?: Error) {
    super(
      message,
      'WEB_SCRAPER_ERROR',
      500,
      true,
      { siteId, cause: cause?.message }
    );
  }
}
```

### Error Handling Pattern

```typescript
// ✅ CORRECT - Structured error handling
try {
  const result = await service.scrapeMessages(config);
  return { success: true, data: result };
} catch (error) {
  if (error instanceof OAuthSessionExpiredError) {
    logger.warn('OAuth session expired', { siteId: error.context?.siteId });
    return {
      success: false,
      error: error.message,
      code: error.code,
      requiresUserAction: true
    };
  }

  if (error instanceof AppError && error.isOperational) {
    logger.error('Operational error', { error: error.message, context: error.context });
    return { success: false, error: error.message, code: error.code };
  }

  // Unexpected error
  logger.error('Unexpected error', { error, stack: error.stack });
  throw error; // Let global handler deal with it
}

// ❌ WRONG - Generic catch with any
catch (err: any) {
  console.error(err);
  return { success: false, error: err.message };
}
```

## 📝 Logging Standards

### Use Winston - REQUIRED

```typescript
// src/utils/logger.ts
import winston from 'winston';
import path from 'path';

const logDir = path.join(app.getPath('userData'), 'logs');

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'wovly-desktop' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}
```

### Logging Levels - When to Use

```typescript
// ✅ CORRECT usage
logger.error('Failed to scrape website', {
  error: error.message,
  siteId,
  stack: error.stack
});

logger.warn('OAuth session expired', {
  siteId,
  lastLoginAt: session.lastLoginAt
});

logger.info('Starting OAuth login flow', {
  siteId,
  provider: oauth.provider
});

logger.debug('Navigation step completed', {
  siteId,
  step: stepNumber,
  selector: step.selector
});

// ❌ FORBIDDEN
console.log('[WebScraper] Starting...');
console.error('Error:', err);
```

### Structured Logging - ALWAYS

```typescript
// ✅ CORRECT - Structured with context
logger.info('User authenticated', {
  userId: user.id,
  method: 'oauth',
  provider: 'google',
  duration: performance.now() - startTime
});

// ❌ WRONG - String concatenation
logger.info(`User ${user.id} authenticated via ${provider}`);
```

## ⚙️ Configuration Management

### Use Zod for Validation - REQUIRED

```typescript
// src/config/env.config.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Session timeouts
  FORM_SESSION_TIMEOUT_MS: z.coerce.number().default(3600000), // 1 hour
  OAUTH_SESSION_TIMEOUT_MS: z.coerce.number().default(604800000), // 7 days

  // Scraper limits
  MAX_SCRAPER_ELEMENTS: z.coerce.number().default(500),
  SCRAPER_TIMEOUT_MS: z.coerce.number().default(30000),

  // API keys (optional in dev, required in prod)
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const loadConfig = (): EnvConfig => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

export const config = loadConfig();
```

### Application Config

```typescript
// src/config/app.config.ts
import { config as envConfig } from './env.config';

export const appConfig = {
  session: {
    form: {
      timeout: envConfig.FORM_SESSION_TIMEOUT_MS,
    },
    oauth: {
      timeout: envConfig.OAUTH_SESSION_TIMEOUT_MS,
    }
  },
  scraper: {
    maxElements: envConfig.MAX_SCRAPER_ELEMENTS,
    timeout: envConfig.SCRAPER_TIMEOUT_MS,
  },
  logging: {
    level: envConfig.LOG_LEVEL,
  }
} as const;

// ❌ NEVER hardcode values
const timeout = 3600000; // Bad
```

## 🔒 Security Requirements

### Credential Storage - MANDATORY PRACTICES

```typescript
// ✅ CORRECT - Use electron-store with encryption
import Store from 'electron-store';

const store = new Store({
  encryptionKey: process.env.ENCRYPTION_KEY, // From secure source
  name: 'credentials'
});

// Save
await store.set(`credentials.${domain}`, {
  username: encrypt(username),
  password: encrypt(password)
});

// Load
const creds = await store.get(`credentials.${domain}`);
return {
  username: decrypt(creds.username),
  password: decrypt(creds.password)
};

// ❌ WRONG - Plain text storage
fs.writeFileSync('credentials.json', JSON.stringify({ password }));
```

### API Key Management

```typescript
// ✅ CORRECT - System keychain
import keytar from 'keytar';

export class SecretsManager {
  private static readonly SERVICE_NAME = 'wovly-assistant';

  static async setApiKey(provider: string, key: string): Promise<void> {
    await keytar.setPassword(this.SERVICE_NAME, provider, key);
  }

  static async getApiKey(provider: string): Promise<string | null> {
    return await keytar.getPassword(this.SERVICE_NAME, provider);
  }
}

// ❌ WRONG - Environment variables only
const apiKey = process.env.ANTHROPIC_API_KEY;
```

### Input Validation - ALWAYS

```typescript
// ✅ CORRECT - Validate all IPC inputs
import { z } from 'zod';

const OAuthParamsSchema = z.object({
  url: z.string().url(),
  siteName: z.string().min(1).max(100),
  siteId: z.string().uuid().optional(),
  oauth: z.object({
    provider: z.enum(['google', 'microsoft', 'facebook', 'generic']),
    loginDetectionSelector: z.string().optional(),
    successDetectionSelector: z.string().optional()
  }).optional()
});

export const launchOAuthLogin = async (event, params: unknown) => {
  // Validate
  const validated = OAuthParamsSchema.parse(params);

  // Use validated data
  return await service.launchOAuthLogin(validated);
};

// ❌ WRONG - Trust all inputs
export const launchOAuthLogin = async (event, params: any) => {
  return await service.launchOAuthLogin(params);
};
```

## 📚 Documentation Standards

### Code Comments - When Required

```typescript
/**
 * Launches OAuth login flow for a custom website integration.
 *
 * Opens a headful browser window with instruction overlay,
 * waits for user to complete OAuth authentication,
 * then captures and persists session cookies.
 *
 * @param params - OAuth login parameters
 * @param params.url - Website login URL
 * @param params.siteName - Display name for the site
 * @param params.siteId - Optional existing site ID for re-login
 * @param params.oauth - OAuth provider configuration
 *
 * @returns Promise resolving to OAuth result with success status
 *
 * @throws {OAuthTimeoutError} If user doesn't complete login within timeout
 * @throws {BrowserError} If browser fails to launch
 *
 * @example
 * ```typescript
 * const result = await service.launchOAuthLogin({
 *   url: 'https://notion.so/login',
 *   siteName: 'Notion Workspace',
 *   oauth: { provider: 'google' }
 * });
 * ```
 */
async launchOAuthLogin(params: OAuthLoginParams): Promise<OAuthResult> {
  // Implementation
}
```

**Comment Rules:**
- ✅ Document **why**, not **what** (code shows what)
- ✅ Document **non-obvious** behavior
- ✅ Document **public APIs** with JSDoc
- ❌ Don't comment **obvious** code
- ❌ Don't leave **TODO** comments without issues

### README Requirements for New Features

Every new feature must include:

```markdown
## Feature Name

### Purpose
Brief description of what this feature does.

### Usage
```typescript
// Code example
```

### Configuration
Environment variables or config required.

### Testing
How to test this feature.

### Known Limitations
Any caveats or edge cases.
```

## 🚫 Forbidden Patterns

### Absolutely Never Do This:

```typescript
// ❌ FORBIDDEN #1 - Adding to main.js
// DON'T: Add anything to main.js over 17K lines
// DO: Extract service first, then add feature

// ❌ FORBIDDEN #2 - Any type
function processData(data: any) { }
// DO: Define proper types
function processData(data: UserData) { }

// ❌ FORBIDDEN #3 - console.log in production code
console.log('Debug info:', data);
// DO: Use logger
logger.debug('Processing data', { data });

// ❌ FORBIDDEN #4 - Synchronous file operations
const data = fs.readFileSync('file.json');
// DO: Use async
const data = await fs.promises.readFile('file.json');

// ❌ FORBIDDEN #5 - Catch without logging
try { } catch (err) { /* silently fail */ }
// DO: Always log or rethrow
try { } catch (err) {
  logger.error('Operation failed', { error: err });
  throw err;
}

// ❌ FORBIDDEN #6 - Hardcoded credentials/keys
const apiKey = 'sk-1234567890';
// DO: Use environment/secrets manager
const apiKey = await secrets.getApiKey('anthropic');

// ❌ FORBIDDEN #7 - Direct database queries in handlers
ipcMain.handle('getUser', async (event, id) => {
  return db.query('SELECT * FROM users WHERE id = ?', [id]);
});
// DO: Use repository pattern
const user = await userRepository.findById(id);

// ❌ FORBIDDEN #8 - Mutating function parameters
function updateUser(user: User) {
  user.name = 'Changed'; // Mutation!
}
// DO: Return new object
function updateUser(user: User): User {
  return { ...user, name: 'Changed' };
}
```

## ✅ Pre-Commit Checklist

Before any commit, AI assistant MUST verify:

- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] ESLint passes (`npm run lint`)
- [ ] All tests pass (`npm run test`)
- [ ] Test coverage > 80% for new code
- [ ] No new files > 500 lines
- [ ] No logic added to `main.js`
- [ ] All errors use custom error classes
- [ ] All logs use winston logger
- [ ] All configs use zod validation
- [ ] All IPC inputs validated
- [ ] JSDoc added for public APIs
- [ ] README updated for new features

## 🔄 Migration Strategy for Existing Code

When modifying existing code that doesn't follow these guidelines:

### Step 1: Assess
- If file < 300 lines: Refactor inline
- If file > 300 lines: Extract first, then modify

### Step 2: Extract Services
```typescript
// Before: Logic in main.js
ipcMain.handle('webscraper:scrape', async (event, config) => {
  const scraper = new WebScraper();
  return await scraper.scrape(config);
});

// After: Extract to service
// 1. Create src/services/WebScraperService.ts
// 2. Move logic there
// 3. Update IPC handler to use service
const service = container.get<WebScraperService>(TYPES.WebScraperService);
return await service.scrape(config);
```

### Step 3: Add Types
```typescript
// Before: JavaScript
function scrape(config) {
  return { success: true };
}

// After: TypeScript with interfaces
interface ScrapeConfig {
  url: string;
  selectors: Selectors;
}

interface ScrapeResult {
  success: boolean;
  messages?: Message[];
  error?: string;
}

async function scrape(config: ScrapeConfig): Promise<ScrapeResult> {
  return { success: true };
}
```

### Step 4: Add Tests
```typescript
// Create __tests__/WebScraperService.spec.ts
describe('WebScraperService', () => {
  it('should scrape messages successfully', async () => {
    // Test implementation
  });
});
```

### Step 5: Document
Add JSDoc comments and update README.

## 🎯 Code Review Criteria

Every PR must meet these standards:

### Automated Checks (CI)
- ✅ TypeScript compiles
- ✅ ESLint passes
- ✅ Tests pass (>80% coverage)
- ✅ Build succeeds

### Manual Review
- ✅ Follows architecture principles
- ✅ Proper error handling
- ✅ Adequate logging
- ✅ Security best practices
- ✅ Documentation updated
- ✅ No code smells

### Code Smells to Reject
- ❌ File > 500 lines
- ❌ Function > 50 lines
- ❌ Nesting > 3 levels
- ❌ console.log in code
- ❌ any types
- ❌ Hardcoded values
- ❌ Missing tests

## 🚀 Performance Guidelines

### Database/File Operations
```typescript
// ✅ CORRECT - Batch operations
const users = await Promise.all(
  userIds.map(id => userRepository.findById(id))
);

// ❌ WRONG - Sequential operations
const users = [];
for (const id of userIds) {
  users.push(await userRepository.findById(id));
}
```

### Caching Strategy
```typescript
// ✅ CORRECT - Cache expensive operations
class WebScraperService {
  private cache = new Map<string, CachedResult>();

  async scrape(config: ScrapeConfig): Promise<ScrapeResult> {
    const cacheKey = `${config.siteId}-${config.url}`;
    const cached = this.cache.get(cacheKey);

    if (cached && !this.isCacheExpired(cached)) {
      logger.debug('Using cached result', { cacheKey });
      return cached.data;
    }

    const result = await this.performScrape(config);
    this.cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }
}
```

## 📖 Additional Resources

- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Clean Code Principles](https://github.com/ryanmcdermott/clean-code-javascript)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

## 🤖 AI Assistant Instructions

When working on this codebase:

1. **Read this file first** before making any changes
2. **Ask for clarification** if guidelines conflict with requirements
3. **Propose architecture** before implementing large features
4. **Extract before extending** - refactor before adding to large files
5. **Test-driven development** - write tests first for new features
6. **Document as you go** - update docs with code changes
7. **Flag violations** - alert user if existing code violates guidelines

### Example AI Workflow

```
User: "Add feature to export messages to PDF"

AI Response:
1. Check: main.js is 17K lines - cannot add there
2. Propose: Create src/services/ExportService.ts
3. Design:
   - Interface: IExportService
   - Class: ExportService (with DI)
   - Tests: ExportService.spec.ts
4. Implement with TypeScript
5. Add IPC handler in src/ipc/handlers/export.handlers.ts
6. Update documentation
7. Run tests
```

## 🔒 Breaking Glass Procedures

In emergencies only (production down):

1. ✅ Can commit without tests (add TODO issue)
2. ✅ Can use console.log (remove after debug)
3. ✅ Can exceed file size limits (refactor later)
4. ❌ Still MUST use TypeScript
5. ❌ Still MUST handle errors properly
6. ❌ Still MUST validate inputs

**After emergency:**
- Create issue to fix technical debt
- Refactor within 48 hours
- Add missing tests
- Update documentation

---

**Last Updated:** 2026-02-17
**Version:** 1.0.0
**Maintainer:** @jeffchou
