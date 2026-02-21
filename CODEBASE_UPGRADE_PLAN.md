# Codebase Upgrade Plan - Complete Refactoring Roadmap

**Goal**: Transform the codebase from prototype to production-ready, maintainable software.

**Timeline**: 12 weeks (3 months)
**Estimated Effort**: ~240 hours
**Current State**: 17K-line monolith, no tests, JavaScript
**Target State**: Modular TypeScript, 80%+ test coverage, CI/CD

---

## 📊 Executive Summary

| Phase | Focus | Duration | Risk | Impact |
|-------|-------|----------|------|--------|
| 0 | Foundation Setup | 1 week | Low | High |
| 1 | Testing Infrastructure | 1 week | Low | High |
| 2 | TypeScript Migration | 2 weeks | Medium | High |
| 3 | Service Extraction | 3 weeks | High | Critical |
| 4 | Architecture Refactor | 2 weeks | High | Critical |
| 5 | Security & Performance | 1 week | Medium | High |
| 6 | Documentation & CI/CD | 2 weeks | Low | Medium |

**Total**: 12 weeks

---

## Phase 0: Foundation Setup (Week 1)

**Goal**: Establish tooling, standards, and safety nets before refactoring.

### Tasks

#### 0.1 Version Control & Branching Strategy
```bash
# Create development branch
git checkout -b develop

# Create feature branch structure
git checkout -b phase-0/foundation-setup
```

**Branch strategy**:
- `main` - Production releases only
- `develop` - Integration branch
- `phase-X/feature-name` - Feature branches

#### 0.2 Install Core Development Tools

```bash
# TypeScript
npm install -D typescript @types/node @types/electron
npm install -D @types/react @types/react-dom

# Testing
npm install -D vitest @vitest/ui @vitest/coverage-v8
npm install -D @testing-library/react @testing-library/jest-dom
npm install -D @testing-library/user-event

# Linting & Formatting
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D prettier eslint-config-prettier eslint-plugin-prettier

# Git Hooks
npm install -D husky lint-staged

# Dependency Injection
npm install inversify reflect-metadata

# Validation
npm install zod

# Logging
npm install winston winston-daily-rotate-file

# Security
npm install electron-store keytar
```

#### 0.3 Configuration Files

**Create `tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node", "electron"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Create `.eslintrc.json`**:
```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier"
  ],
  "plugins": ["@typescript-eslint"],
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": "error",
    "no-console": ["warn", { "allow": ["error"] }],
    "max-lines": ["error", { "max": 500, "skipBlankLines": true, "skipComments": true }],
    "max-lines-per-function": ["warn", { "max": 50 }],
    "complexity": ["warn", 10]
  }
}
```

**Create `.prettierrc.json`**:
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

**Create `vitest.config.ts`**:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/types.ts',
      ],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Update `package.json` scripts**:
```json
{
  "scripts": {
    "dev": "electron .",
    "build": "tsc && npm run build:ui && electron-builder --mac",
    "build:ui": "npm run -w apps/ui build",

    "type-check": "tsc --noEmit",
    "lint": "eslint src/**/*.ts --max-warnings 0",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,json}\"",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,json}\"",

    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",

    "prepare": "husky install",
    "pre-commit": "lint-staged"
  }
}
```

**Create `.husky/pre-commit`**:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run type-check
npm run lint
npm run test
```

**Create `.lintstagedrc.json`**:
```json
{
  "*.ts": [
    "eslint --fix",
    "prettier --write"
  ],
  "*.{json,md}": [
    "prettier --write"
  ]
}
```

#### 0.4 Create New Directory Structure

```bash
mkdir -p apps/desktop/src/{ipc,services,repositories,models,types,config,utils,middleware,di}
mkdir -p apps/desktop/src/ipc/handlers
mkdir -p apps/desktop/tests/{unit,integration,e2e}
mkdir -p apps/desktop/docs/{architecture,features,development,api}
```

#### 0.5 Create Baseline Documentation

**Create `docs/architecture/system-overview.md`**:
```markdown
# System Architecture Overview

## Current State (Phase 0)
- Monolithic main.js (17,509 lines)
- JavaScript codebase
- No tests
- No type safety

## Target State (Phase 6)
- Modular TypeScript services
- 80%+ test coverage
- Layered architecture
- Full CI/CD pipeline

## Architecture Diagram
[To be updated each phase]
```

**Deliverables**:
- ✅ All dev tools installed
- ✅ Configuration files created
- ✅ Directory structure established
- ✅ Git hooks configured
- ✅ Baseline documentation created

**Success Criteria**:
- `npm run type-check` passes (even with empty TS files)
- `npm run lint` runs without errors
- Pre-commit hooks execute successfully

---

## Phase 1: Testing Infrastructure (Week 2)

**Goal**: Create testing framework and write first tests before refactoring.

### 1.1 Create Test Utilities

**Create `tests/helpers/testUtils.ts`**:
```typescript
import { vi } from 'vitest';

export const createMock = <T>(): jest.Mocked<T> => {
  return {} as jest.Mocked<T>;
};

export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

export const mockBrowserController = {
  getPage: vi.fn(),
  newPage: vi.fn(),
  closePage: vi.fn(),
};

export const createTestConfig = (overrides = {}) => ({
  id: 'test-site',
  name: 'Test Site',
  url: 'https://example.com',
  authMethod: 'form',
  ...overrides,
});
```

### 1.2 Write Characterization Tests for Critical Paths

**Goal**: Capture current behavior before refactoring.

**Create `tests/integration/webscraper.test.ts`**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { WebScraper } from '../../src/webscraper/scraper';

describe('WebScraper (Characterization Tests)', () => {
  // These tests document CURRENT behavior
  // They may fail initially - that's OK
  // Goal: Understand what breaks when we refactor

  it('should scrape messages from form-based auth site', async () => {
    // Test current behavior
  });

  it('should handle OAuth session expiry', async () => {
    // Test current behavior
  });

  it('should fall back to cached messages on failure', async () => {
    // Test current behavior
  });
});
```

**Create `tests/integration/insights-processor.test.ts`**:
```typescript
describe('Insights Processor (Characterization Tests)', () => {
  it('should collect messages from all sources', async () => {
    // Test current behavior
  });
});
```

### 1.3 Set Up Test Data Fixtures

**Create `tests/fixtures/siteConfigs.ts`**:
```typescript
export const formAuthSiteConfig = {
  id: 'brightwheel-test',
  name: 'Brightwheel Test',
  url: 'https://example.com',
  authMethod: 'form' as const,
  credentials: { username: 'test@example.com', password: 'test123' },
  selectors: {
    login: {
      usernameField: 'input[name="email"]',
      passwordField: 'input[type="password"]',
      submitButton: 'button[type="submit"]',
      successIndicator: '.dashboard',
    },
    navigation: [],
    messages: {
      container: '.messages-list',
      messageItem: '.message',
      sender: '.sender',
      content: '.content',
      timestamp: '.timestamp',
    },
  },
};

export const oauthSiteConfig = {
  id: 'notion-test',
  name: 'Notion Test',
  url: 'https://notion.so/login',
  authMethod: 'oauth' as const,
  oauth: {
    oauthProvider: 'google',
    loginDetectionSelector: 'button:contains("Sign in")',
    successDetectionSelector: '.notion-topbar',
  },
  selectors: {
    navigation: [],
    messages: {
      container: '.messages',
      messageItem: '.message',
      sender: '.author',
      content: '.body',
      timestamp: '.date',
    },
  },
};
```

### 1.4 Create Test Coverage Baseline

```bash
# Run tests and generate coverage report
npm run test:coverage

# Save baseline
cp coverage/coverage-summary.json baseline-coverage.json
```

**Deliverables**:
- ✅ Test utilities created
- ✅ Characterization tests written (even if failing)
- ✅ Test fixtures created
- ✅ Coverage baseline established

**Success Criteria**:
- `npm run test` executes without crashing
- Coverage report generated (even if 0%)
- CI can run tests automatically

---

## Phase 2: TypeScript Migration (Weeks 3-4)

**Goal**: Migrate existing JavaScript to TypeScript incrementally.

### 2.1 Migration Strategy

**Bottom-up approach**: Start with leaf modules (no dependencies), work up to main.js.

#### Week 3: Utility & Storage Modules

**Priority order**:
1. `src/utils/*.js` → `src/utils/*.ts`
2. `src/storage/*.js` → `src/storage/*.ts`
3. `src/webscraper/*.js` → `src/webscraper/*.ts`

**Process for each file**:
```bash
# 1. Rename file
mv src/utils/helpers.js src/utils/helpers.ts

# 2. Add types incrementally
# Start with function signatures
export function parseTimestamp(timestamp: string): Date {
  // Implementation
}

# 3. Run type-check
npm run type-check

# 4. Fix errors one by one
# Use 'any' as last resort with TODO comment

# 5. Write tests
# Create src/utils/__tests__/helpers.test.ts

# 6. Commit
git add src/utils/helpers.ts
git commit -m "feat: migrate helpers.ts to TypeScript"
```

#### Week 4: Integration & Core Modules

**Priority order**:
1. `src/insights/*.js` → `src/insights/*.ts`
2. `src/integrations/*.js` → `src/integrations/*.ts`
3. `src/llm/*.js` → `src/llm/*.ts`
4. `src/browser/*.js` → `src/browser/*.ts`

### 2.2 Type Definitions

**Create `src/types/common.ts`**:
```typescript
export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
}

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
}

export interface AppConfig {
  session: {
    form: { timeout: number };
    oauth: { timeout: number };
  };
  scraper: {
    maxElements: number;
    timeout: number;
  };
}

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };
```

**Create `src/types/webscraper.ts`**:
```typescript
export type AuthMethod = 'form' | 'oauth';

export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  authMethod: AuthMethod;
  credentials?: Credentials;
  oauth?: OAuthConfig;
  selectors: Selectors;
  sessionManagement: SessionManagement;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface OAuthConfig {
  oauthProvider: 'google' | 'microsoft' | 'facebook' | 'generic';
  loginDetectionSelector?: string;
  successDetectionSelector?: string;
}

export interface Selectors {
  login?: LoginSelectors;
  navigation: NavigationStep[];
  messages: MessageSelectors;
}

export interface LoginSelectors {
  usernameField: string;
  passwordField: string;
  submitButton: string;
  successIndicator: string;
}

export interface NavigationStep {
  step: number;
  action: 'click' | 'type' | 'select';
  selector: string;
  waitFor?: string;
  description: string;
}

export interface MessageSelectors {
  container: string;
  messageItem: string;
  sender: string;
  content: string;
  timestamp: string;
}

export interface SessionManagement {
  saveSession: boolean;
  sessionTimeout: number;
}

export interface ScrapeResult {
  success: boolean;
  messages?: Message[];
  error?: string;
  errorType?: string;
  requiresManualLogin?: boolean;
}

export interface Message {
  platform: string;
  from: string;
  subject: string;
  body: string;
  timestamp: string;
  snippet: string;
  source: string;
  sourceUrl?: string;
  scrapedAt?: string;
  originalTimestamp?: string | null;
}
```

### 2.3 Migration Checklist Per File

```markdown
For each file being migrated:

- [ ] Rename .js to .ts
- [ ] Add return types to all functions
- [ ] Add parameter types to all functions
- [ ] Replace `require()` with `import`
- [ ] Define interfaces for complex objects
- [ ] Remove all `any` types (or add TODO)
- [ ] Add JSDoc comments to public APIs
- [ ] Write unit tests
- [ ] Run `npm run type-check`
- [ ] Run `npm run lint:fix`
- [ ] Run `npm run test`
- [ ] Update imports in dependent files
- [ ] Commit with conventional commit message
```

### 2.4 TypeScript Migration Tracking

**Create `MIGRATION_TRACKER.md`**:
```markdown
# TypeScript Migration Progress

## Week 3
- [x] src/utils/helpers.ts
- [x] src/utils/cache.ts
- [x] src/storage/memory.ts
- [x] src/storage/webmessages.ts
- [ ] src/webscraper/scraper.ts
- [ ] ...

## Week 4
- [ ] src/insights/processor.ts
- [ ] ...

## Blockers
- main.js - Too large, needs extraction first

## Metrics
- Files migrated: 15/87 (17%)
- Type coverage: 45%
- Tests added: 8
```

**Deliverables**:
- ✅ 50%+ of codebase migrated to TypeScript
- ✅ All type definitions created
- ✅ Type coverage > 70%
- ✅ Zero TypeScript errors in migrated files

**Success Criteria**:
- `npm run type-check` passes
- All migrated files have tests
- No regression in functionality

---

## Phase 3: Service Extraction from main.js (Weeks 5-7)

**Goal**: Break down 17K-line main.js into modular services.

**This is the MOST CRITICAL and RISKY phase.**

### 3.1 Analysis & Mapping (Week 5, Day 1-2)

**Create service extraction plan**:

```bash
# Analyze main.js structure
npm install -g sloc
sloc apps/desktop/main.js

# Extract function names and their line numbers
grep -n "^function\|^const.*=.*function\|^const.*=.*async" apps/desktop/main.js > main-js-functions.txt

# Categorize by domain
```

**Create `SERVICE_EXTRACTION_PLAN.md`**:
```markdown
# main.js Service Extraction Plan

## Analysis
- Total lines: 17,509
- IPC handlers: ~150
- Business logic functions: ~200
- Helper functions: ~50

## Service Categories

### 1. AuthService (Lines 100-500)
- User authentication
- Session management
- Password hashing
**Dependencies**: UserRepository, SessionStore
**Priority**: High (many dependencies)

### 2. WebScraperService (Lines 5000-5800)
- OAuth login handling
- Message scraping
- Site configuration
**Dependencies**: BrowserController, ConfigManager
**Priority**: Medium (recently added)

### 3. IntegrationsService (Lines 2000-3500)
- Gmail integration
- Slack integration
- iMessage integration
**Dependencies**: GoogleAPI, SlackAPI
**Priority**: High (core feature)

... (continue for all services)

## Extraction Order
1. Utility services (no dependencies)
2. Data access layer (repositories)
3. Business logic services
4. IPC handlers (last)
```

### 3.2 Create Service Template (Week 5, Day 3)

**Create `src/services/BaseService.ts`**:
```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/types';
import { ILogger } from '../types/logger';

@injectable()
export abstract class BaseService {
  constructor(@inject(TYPES.Logger) protected logger: ILogger) {}

  protected logInfo(message: string, context?: Record<string, unknown>): void {
    this.logger.info(message, { service: this.constructor.name, ...context });
  }

  protected logError(message: string, error: Error, context?: Record<string, unknown>): void {
    this.logger.error(message, {
      service: this.constructor.name,
      error: error.message,
      stack: error.stack,
      ...context,
    });
  }

  protected logWarn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(message, { service: this.constructor.name, ...context });
  }
}
```

### 3.3 Extract First Service (Week 5, Day 4-5)

**Start with smallest, most isolated service**:

**Create `src/services/WebScraperService.ts`**:
```typescript
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types';
import { BaseService } from './BaseService';
import { IOAuthLoginHandler } from '../types/oauth';
import { IBrowserController } from '../types/browser';
import { IConfigManager } from '../types/config';
import type { OAuthLoginParams, OAuthResult, ScrapeResult, SiteConfig } from '../types/webscraper';

export interface IWebScraperService {
  launchOAuthLogin(params: OAuthLoginParams): Promise<OAuthResult>;
  scrapeMessages(config: SiteConfig): Promise<ScrapeResult>;
  testIntegration(siteId: string): Promise<{ success: boolean; messageCount: number }>;
}

@injectable()
export class WebScraperService extends BaseService implements IWebScraperService {
  constructor(
    @inject(TYPES.OAuthLoginHandler) private oauthHandler: IOAuthLoginHandler,
    @inject(TYPES.BrowserController) private browser: IBrowserController,
    @inject(TYPES.ConfigManager) private config: IConfigManager,
    @inject(TYPES.Logger) logger: ILogger
  ) {
    super(logger);
  }

  async launchOAuthLogin(params: OAuthLoginParams): Promise<OAuthResult> {
    this.logInfo('Launching OAuth login', { params });

    try {
      // MOVE logic from main.js here
      const result = await this.oauthHandler.launchManualLogin(params);

      this.logInfo('OAuth login completed', { success: result.success });
      return result;
    } catch (error) {
      this.logError('OAuth login failed', error as Error, { params });
      throw error;
    }
  }

  async scrapeMessages(config: SiteConfig): Promise<ScrapeResult> {
    // MOVE logic from main.js here
  }

  async testIntegration(siteId: string): Promise<{ success: boolean; messageCount: number }> {
    // MOVE logic from main.js here
  }
}
```

**Create `src/services/__tests__/WebScraperService.test.ts`**:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebScraperService } from '../WebScraperService';
import { createMock } from '../../../tests/helpers/testUtils';

describe('WebScraperService', () => {
  let service: WebScraperService;
  let mockOAuthHandler: jest.Mocked<IOAuthLoginHandler>;
  let mockBrowser: jest.Mocked<IBrowserController>;

  beforeEach(() => {
    mockOAuthHandler = createMock<IOAuthLoginHandler>();
    mockBrowser = createMock<IBrowserController>();
    service = new WebScraperService(mockOAuthHandler, mockBrowser, mockConfig, mockLogger);
  });

  describe('launchOAuthLogin', () => {
    it('should successfully launch OAuth login', async () => {
      // Test implementation
    });
  });
});
```

### 3.4 Extraction Process (Weeks 6-7)

**Weekly goals**:
- Week 6: Extract 5-7 services
- Week 7: Extract remaining services, update main.js

**Process for each service**:

```typescript
// Step 1: Create interface
export interface IAuthService {
  login(username: string, password: string): Promise<Result<User>>;
  logout(): Promise<void>;
}

// Step 2: Create implementation with DI
@injectable()
export class AuthService extends BaseService implements IAuthService {
  constructor(
    @inject(TYPES.UserRepository) private userRepo: IUserRepository,
    @inject(TYPES.Logger) logger: ILogger
  ) {
    super(logger);
  }

  async login(username: string, password: string): Promise<Result<User>> {
    // Move logic from main.js
  }
}

// Step 3: Register in DI container
container.bind<IAuthService>(TYPES.AuthService).to(AuthService);

// Step 4: Update IPC handler
ipcMain.handle('auth:login', async (event, { username, password }) => {
  const authService = container.get<IAuthService>(TYPES.AuthService);
  return await authService.login(username, password);
});

// Step 5: Write tests

// Step 6: Delete code from main.js

// Step 7: Verify tests still pass
```

### 3.5 Service List to Extract

```markdown
Priority order (extract in this sequence):

Week 6:
1. WebScraperService ✓ (already started)
2. AuthService
3. SettingsService
4. ProfileService
5. IntegrationsService (base)
6. CalendarService
7. InsightsService

Week 7:
8. GoogleIntegrationService
9. SlackIntegrationService
10. IMessageService
11. TelegramService
12. TaskService
13. SkillsService
14. CredentialsService
15. WhatsAppService
```

### 3.6 DI Container Setup

**Create `src/di/container.ts`**:
```typescript
import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';

// Services
import { WebScraperService } from '../services/WebScraperService';
import { AuthService } from '../services/AuthService';
// ... import all services

// Create container
const container = new Container();

// Bind services
container.bind<IWebScraperService>(TYPES.WebScraperService).to(WebScraperService);
container.bind<IAuthService>(TYPES.AuthService).to(AuthService);
// ... bind all services

export { container };
```

**Create `src/di/types.ts`**:
```typescript
export const TYPES = {
  // Services
  WebScraperService: Symbol.for('WebScraperService'),
  AuthService: Symbol.for('AuthService'),
  IntegrationsService: Symbol.for('IntegrationsService'),

  // Repositories
  UserRepository: Symbol.for('UserRepository'),
  ConfigRepository: Symbol.for('ConfigRepository'),

  // Infrastructure
  Logger: Symbol.for('Logger'),
  BrowserController: Symbol.for('BrowserController'),

  // Handlers
  OAuthLoginHandler: Symbol.for('OAuthLoginHandler'),
} as const;
```

### 3.7 IPC Handler Refactoring

**Create `src/ipc/handlers/webscraper.handlers.ts`**:
```typescript
import { IpcMainInvokeEvent } from 'electron';
import { container } from '../../di/container';
import { TYPES } from '../../di/types';
import { IWebScraperService } from '../../services/WebScraperService';
import type { OAuthLoginParams } from '../../types/webscraper';

export const webScraperHandlers = {
  'webscraper:launchOAuthLogin': async (
    event: IpcMainInvokeEvent,
    params: OAuthLoginParams
  ) => {
    const service = container.get<IWebScraperService>(TYPES.WebScraperService);
    return await service.launchOAuthLogin(params);
  },

  'webscraper:testIntegration': async (event: IpcMainInvokeEvent, { siteId }: { siteId: string }) => {
    const service = container.get<IWebScraperService>(TYPES.WebScraperService);
    return await service.testIntegration(siteId);
  },

  // ... other handlers
};
```

**Create `src/ipc/registry.ts`**:
```typescript
import { ipcMain } from 'electron';
import { webScraperHandlers } from './handlers/webscraper.handlers';
import { authHandlers } from './handlers/auth.handlers';
// ... import all handlers

export const registerIpcHandlers = (): void => {
  // Register WebScraper handlers
  Object.entries(webScraperHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });

  // Register Auth handlers
  Object.entries(authHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler);
  });

  // ... register all handlers
};
```

**Update `src/main.ts`** (new slim version):
```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { container } from './di/container';
import { registerIpcHandlers } from './ipc/registry';
import { logger } from './utils/logger';

let mainWindow: BrowserWindow | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
};

app.whenReady().then(() => {
  logger.info('App starting');

  // Register all IPC handlers
  registerIpcHandlers();

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

**Target: main.ts should be ~100 lines total**

**Deliverables**:
- ✅ 15 services extracted
- ✅ main.js reduced from 17K to <500 lines
- ✅ All IPC handlers in separate files
- ✅ DI container configured
- ✅ All tests passing

**Success Criteria**:
- `main.js` < 500 lines (target: 100)
- `npm run test` passes
- `npm run type-check` passes
- No functionality broken

---

## Phase 4: Architecture Refactoring (Weeks 8-9)

**Goal**: Implement proper layered architecture.

### 4.1 Repository Layer (Week 8)

**Create data access abstraction**:

**Create `src/repositories/BaseRepository.ts`**:
```typescript
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types';
import { ILogger } from '../types/logger';

@injectable()
export abstract class BaseRepository<T> {
  constructor(@inject(TYPES.Logger) protected logger: ILogger) {}

  abstract findById(id: string): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract create(data: Partial<T>): Promise<T>;
  abstract update(id: string, data: Partial<T>): Promise<T>;
  abstract delete(id: string): Promise<boolean>;
}
```

**Create `src/repositories/UserRepository.ts`**:
```typescript
import { injectable } from 'inversify';
import { BaseRepository } from './BaseRepository';
import { User } from '../models/User';

export interface IUserRepository {
  findByUsername(username: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: Partial<User>): Promise<User>;
}

@injectable()
export class UserRepository extends BaseRepository<User> implements IUserRepository {
  async findByUsername(username: string): Promise<User | null> {
    // Implementation using storage
  }

  async findById(id: string): Promise<User | null> {
    // Implementation
  }

  async create(user: Partial<User>): Promise<User> {
    // Implementation
  }
}
```

**Create repositories for**:
- SiteConfigRepository (web scraper configs)
- CredentialsRepository (encrypted credentials)
- SessionRepository (auth sessions)
- IntegrationRepository (integration configs)
- TaskRepository (background tasks)

### 4.2 Model Layer (Week 8)

**Create `src/models/User.ts`**:
```typescript
export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly displayName: string,
    public readonly email?: string,
    public readonly createdAt: Date = new Date()
  ) {}

  static fromJSON(json: Record<string, unknown>): User {
    return new User(
      json.id as string,
      json.username as string,
      json.displayName as string,
      json.email as string | undefined,
      new Date(json.createdAt as string)
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      username: this.username,
      displayName: this.displayName,
      email: this.email,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
```

**Create models for**:
- SiteConfig
- Message
- Integration
- Task
- Skill

### 4.3 Middleware Layer (Week 9)

**Create `src/middleware/errorHandler.ts`**:
```typescript
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  context?: Record<string, unknown>;
}

export const handleError = (error: Error): ErrorResponse => {
  if (error instanceof AppError && error.isOperational) {
    logger.warn('Operational error', {
      error: error.message,
      code: error.code,
      context: error.context,
    });

    return {
      success: false,
      error: error.message,
      code: error.code,
      context: error.context,
    };
  }

  // Unexpected error
  logger.error('Unexpected error', {
    error: error.message,
    stack: error.stack,
  });

  return {
    success: false,
    error: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
};
```

**Create `src/middleware/validator.ts`**:
```typescript
import { z, ZodSchema } from 'zod';

export const validate = <T>(schema: ZodSchema<T>, data: unknown): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new ValidationError(messages.join(', '));
    }
    throw error;
  }
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### 4.4 Update Services to Use Repositories (Week 9)

**Before**:
```typescript
// AuthService directly accessing storage
const userData = JSON.parse(await fs.readFile(userPath, 'utf-8'));
```

**After**:
```typescript
@injectable()
export class AuthService extends BaseService {
  constructor(
    @inject(TYPES.UserRepository) private userRepo: IUserRepository,
    @inject(TYPES.Logger) logger: ILogger
  ) {
    super(logger);
  }

  async login(username: string, password: string): Promise<Result<User>> {
    const user = await this.userRepo.findByUsername(username);
    // Business logic
  }
}
```

**Deliverables**:
- ✅ Repository layer implemented
- ✅ Model layer implemented
- ✅ Middleware created
- ✅ Services refactored to use repositories

**Success Criteria**:
- Clear separation of concerns
- No direct file I/O in services
- All data access through repositories
- Tests passing

---

## Phase 5: Security & Performance (Week 10)

**Goal**: Harden security and optimize performance.

### 5.1 Logging Framework

**Create `src/utils/logger.ts`**:
```typescript
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { app } from 'electron';

const logDir = path.join(app.getPath('userData'), 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'wovly-desktop', version: app.getVersion() },
  transports: [
    // Error logs
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
    }),

    // Combined logs
    new DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  ],
});

// Console logging in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    })
  );
}

export { logger };
```

**Replace all `console.log` with logger**:
```bash
# Find all console.log usage
grep -r "console\\.log\|console\\.error\|console\\.warn" apps/desktop/src

# Replace systematically
# Before: console.log('[WebScraper] Starting...');
# After: logger.info('WebScraper starting', { siteId });
```

### 5.2 Environment Configuration

**Create `src/config/env.config.ts`**:
```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Session
  FORM_SESSION_TIMEOUT_MS: z.coerce.number().default(3600000),
  OAUTH_SESSION_TIMEOUT_MS: z.coerce.number().default(604800000),

  // Scraper
  MAX_SCRAPER_ELEMENTS: z.coerce.number().default(500),
  SCRAPER_TIMEOUT_MS: z.coerce.number().default(30000),

  // Security
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // API Keys (loaded from keychain, not env)
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
```

**Create `.env.example`**:
```bash
NODE_ENV=development
LOG_LEVEL=debug

FORM_SESSION_TIMEOUT_MS=3600000
OAUTH_SESSION_TIMEOUT_MS=604800000

MAX_SCRAPER_ELEMENTS=500
SCRAPER_TIMEOUT_MS=30000

# Don't commit real keys - use keychain
# ANTHROPIC_API_KEY=sk-...
```

### 5.3 Secrets Management

**Create `src/utils/secrets.ts`**:
```typescript
import keytar from 'keytar';

const SERVICE_NAME = 'wovly-assistant';

export class SecretsManager {
  static async getApiKey(provider: string): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, `api-key-${provider}`);
  }

  static async setApiKey(provider: string, key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, `api-key-${provider}`, key);
  }

  static async deleteApiKey(provider: string): Promise<boolean> {
    return await keytar.deletePassword(SERVICE_NAME, `api-key-${provider}`);
  }

  static async getEncryptionKey(): Promise<string> {
    const key = await keytar.getPassword(SERVICE_NAME, 'encryption-key');

    if (!key) {
      // Generate new encryption key
      const crypto = await import('crypto');
      const newKey = crypto.randomBytes(32).toString('hex');
      await keytar.setPassword(SERVICE_NAME, 'encryption-key', newKey);
      return newKey;
    }

    return key;
  }
}
```

**Update credential storage**:
```typescript
import Store from 'electron-store';
import { SecretsManager } from '../utils/secrets';

const encryptionKey = await SecretsManager.getEncryptionKey();

const credentialsStore = new Store({
  name: 'credentials',
  encryptionKey,
});
```

### 5.4 Performance Optimizations

**Implement caching**:
```typescript
// src/utils/cache.ts
export class Cache<T> {
  private cache = new Map<string, { data: T; expiresAt: number }>();

  set(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      data: value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  get(key: string): T | null {
    const cached = this.cache.get(key);

    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  clear(): void {
    this.cache.clear();
  }
}
```

**Add to services**:
```typescript
@injectable()
export class WebScraperService extends BaseService {
  private cache = new Cache<ScrapeResult>();

  async scrapeMessages(config: SiteConfig): Promise<ScrapeResult> {
    const cacheKey = `scrape-${config.id}`;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      this.logInfo('Using cached scrape result', { siteId: config.id });
      return cached;
    }

    const result = await this.performScrape(config);
    this.cache.set(cacheKey, result, 300000); // 5 min cache

    return result;
  }
}
```

**Database query optimization**:
```typescript
// Batch operations
const users = await Promise.all(userIds.map(id => userRepo.findById(id)));

// Instead of:
// const users = [];
// for (const id of userIds) {
//   users.push(await userRepo.findById(id));
// }
```

**Deliverables**:
- ✅ Winston logger implemented
- ✅ All console.log replaced
- ✅ Environment config with Zod
- ✅ Keychain integration for secrets
- ✅ Encrypted credential storage
- ✅ Caching implemented

**Success Criteria**:
- No secrets in code/env files
- Logs rotate daily
- Performance improved 20%+

---

## Phase 6: Documentation & CI/CD (Weeks 11-12)

**Goal**: Production-ready documentation and automated workflows.

### 6.1 Consolidate Documentation (Week 11)

**Restructure docs**:
```bash
# Move and organize
mkdir -p docs/{architecture,features,development,api}

# Architecture docs
mv *_PLAN.md docs/architecture/
mv *_ARCHITECTURE.md docs/architecture/

# Feature docs
mv USER_GUIDE_*.md docs/features/
mv QUICKSTART_*.md docs/features/

# Create consolidated docs
```

**Create `docs/README.md`**:
```markdown
# Wovly Documentation

## Architecture
- [System Overview](architecture/system-overview.md)
- [Service Layer](architecture/services.md)
- [Data Flow](architecture/data-flow.md)

## Features
- [OAuth Integration](features/oauth-integration.md)
- [Web Scraper](features/web-scraper.md)
- [Custom Websites](features/custom-websites.md)

## Development
- [Setup Guide](development/setup.md)
- [Testing Guide](development/testing.md)
- [Contributing](development/contributing.md)

## API Reference
- [IPC Handlers](api/ipc-handlers.md)
- [Services](api/services.md)
```

**Generate API docs**:
```bash
npm install -D typedoc

# Generate
npx typedoc --out docs/api src
```

### 6.2 CI/CD Pipeline (Week 11-12)

**Create `.github/workflows/ci.yml`**:
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    name: Test
    runs-on: ${{ matrix.os }}

    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18.x, 20.x]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run type-check

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: unittests

  build:
    name: Build
    runs-on: macos-latest
    needs: test

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20.x
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: dist
          path: apps/desktop/dist/
```

**Create `.github/workflows/release.yml`**:
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ${{ matrix.os }}

    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20.x

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Release
        uses: softprops/action-gh-release@v1
        with:
          files: apps/desktop/dist/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 6.3 Code Quality Badges

**Add to `README.md`**:
```markdown
# Wovly

[![CI](https://github.com/your-org/wovly/workflows/CI/badge.svg)](https://github.com/your-org/wovly/actions)
[![codecov](https://codecov.io/gh/your-org/wovly/branch/main/graph/badge.svg)](https://codecov.io/gh/your-org/wovly)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
```

### 6.4 Developer Onboarding

**Create `docs/development/setup.md`**:
```markdown
# Development Setup

## Prerequisites
- Node.js 18+
- npm 9+
- Git

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/wovly.git
cd wovly

# Install
npm install

# Configure
cp .env.example .env

# Run tests
npm run test

# Start development
npm run dev
```

## Architecture Overview
See [System Overview](../architecture/system-overview.md)

## Testing
See [Testing Guide](testing.md)

## Contributing
See [Contributing Guide](contributing.md)
```

**Deliverables**:
- ✅ Documentation organized
- ✅ API docs generated
- ✅ CI/CD pipeline working
- ✅ Code coverage reporting
- ✅ Developer onboarding guide

**Success Criteria**:
- All CI checks passing
- Coverage > 80%
- Documentation complete
- Build artifacts generated

---

## 📋 Phase-by-Phase Checklist

### Phase 0: Foundation ✓
- [ ] All dev tools installed
- [ ] TypeScript configured
- [ ] ESLint configured
- [ ] Prettier configured
- [ ] Vitest configured
- [ ] Husky pre-commit hooks
- [ ] Directory structure created
- [ ] Baseline documentation

### Phase 1: Testing ✓
- [ ] Test utilities created
- [ ] Characterization tests written
- [ ] Test fixtures created
- [ ] Coverage baseline established
- [ ] CI can run tests

### Phase 2: TypeScript ✓
- [ ] Type definitions created
- [ ] 50%+ files migrated
- [ ] All utils migrated
- [ ] All storage migrated
- [ ] All webscraper migrated
- [ ] Type coverage > 70%
- [ ] Zero TS errors

### Phase 3: Service Extraction ✓
- [ ] Service template created
- [ ] DI container configured
- [ ] WebScraperService extracted
- [ ] AuthService extracted
- [ ] 15+ services extracted
- [ ] IPC handlers refactored
- [ ] main.js < 500 lines
- [ ] All tests passing

### Phase 4: Architecture ✓
- [ ] Repository layer implemented
- [ ] Model layer implemented
- [ ] Middleware created
- [ ] Services use repositories
- [ ] Clear separation of concerns

### Phase 5: Security & Performance ✓
- [ ] Winston logger implemented
- [ ] All console.log replaced
- [ ] Env config with Zod
- [ ] Keychain integration
- [ ] Encrypted credentials
- [ ] Caching implemented

### Phase 6: Docs & CI/CD ✓
- [ ] Docs organized
- [ ] API docs generated
- [ ] CI pipeline working
- [ ] Coverage reporting
- [ ] Release workflow

---

## 🎯 Success Metrics

### Code Quality
| Metric | Baseline | Target | Phase |
|--------|----------|--------|-------|
| Test Coverage | 0% | 80% | 1-6 |
| Type Coverage | 0% | 90% | 2 |
| Max File Size | 17,509 lines | 500 lines | 3 |
| Number of Services | 0 | 15+ | 3-4 |
| Cyclomatic Complexity | Unknown | <10 | 4 |
| Documentation Pages | 18 | 25+ | 6 |

### Performance
| Metric | Baseline | Target |
|--------|----------|--------|
| App Startup Time | ? | <2s |
| Test Execution Time | N/A | <30s |
| Build Time | ? | <5min |
| Memory Usage | ? | <200MB |

### Developer Experience
| Metric | Baseline | Target |
|--------|----------|--------|
| Onboarding Time | Days | <1 hour |
| CI Feedback Time | N/A | <5min |
| PR Review Time | Hours | <30min |

---

## ⚠️ Risk Mitigation

### High-Risk Activities
1. **Service extraction from main.js** (Phase 3)
   - Risk: Breaking existing functionality
   - Mitigation: Comprehensive tests before extraction, feature flags

2. **TypeScript migration** (Phase 2)
   - Risk: Type errors blocking development
   - Mitigation: Incremental migration, `any` escape hatch

3. **Architecture refactor** (Phase 4)
   - Risk: Massive changes, hard to review
   - Mitigation: Small PRs, frequent integration

### Rollback Strategy
```bash
# Each phase is a branch
# Can rollback to previous phase

git checkout phase-2/typescript-migration  # Rollback to Phase 2
git checkout phase-1/testing               # Rollback to Phase 1
```

---

## 📈 Progress Tracking

**Create `REFACTORING_PROGRESS.md`**:
```markdown
# Refactoring Progress

Last Updated: 2026-02-17

## Current Phase: 0 (Foundation)

### Completed
- [x] Dev tools installed

### In Progress
- [ ] TypeScript config

### Blocked
- None

## Metrics
- Lines of code: 17,509 (main.js)
- Test coverage: 0%
- Type coverage: 0%

## Next Steps
1. Finish Phase 0
2. Start Phase 1 (Testing)
```

---

## 🚀 Getting Started

### Week 1 Immediate Actions

```bash
# Day 1: Setup
git checkout -b phase-0/foundation
npm install -D typescript vitest eslint prettier

# Day 2: Configuration
# Create tsconfig.json, .eslintrc.json, vitest.config.ts

# Day 3: Directory Structure
mkdir -p apps/desktop/src/{services,ipc,repositories}
mkdir -p apps/desktop/tests/{unit,integration}

# Day 4: First Test
# Create tests/unit/example.test.ts

# Day 5: Documentation
# Create docs structure
```

---

## 📞 Support

**Questions during refactoring?**
- Check `CLAUDE.md` for guidelines
- Review phase documentation
- Create GitHub issue
- Tag AI assistant for guidance

---

**Ready to begin? Start with Phase 0!**

Run: `npm install -D typescript vitest eslint prettier husky`
