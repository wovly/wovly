# Wovly Desktop Architecture

## Overview

Wovly is an autonomous communication agent built with Electron that helps users manage their Email, Slack, iMessage, and custom web integrations.

## Architecture Layers

### 1. Presentation Layer (UI)
- **Location**: `/apps/ui/`
- **Technology**: React + TypeScript
- **Responsibility**: User interface, state management, IPC communication with main process

### 2. IPC Layer
- **Location**: `/apps/desktop/src/ipc/`
- **Technology**: Electron IPC (Inter-Process Communication)
- **Responsibility**: Bridge between UI and services, request/response handling

### 3. Service Layer
- **Location**: `/apps/desktop/src/services/`
- **Technology**: TypeScript classes with dependency injection
- **Responsibility**: Business logic, orchestration, use case implementation
- **Services**:
  - `InsightsService` - Message collection and analysis
  - `WebScraperService` - Custom web integration management
  - `MemoryService` - Long-term memory and context
  - `TaskService` - Task decomposition and execution
  - `IntegrationService` - Platform integrations (Gmail, Slack, etc.)

### 4. Repository Layer
- **Location**: `/apps/desktop/src/repositories/`
- **Technology**: TypeScript classes
- **Responsibility**: Data access, storage abstraction
- **Repositories**:
  - `WebMessageRepository` - Web scraper message storage
  - `MemoryRepository` - Memory and insights storage
  - `ConfigRepository` - User configuration storage
  - `CredentialRepository` - Secure credential storage

### 5. Storage Layer
- **Location**: `/apps/desktop/src/storage/`
- **Technology**: File system (JSON/Markdown), SQLite (iMessage)
- **Responsibility**: Physical data storage

## Directory Structure

```
apps/desktop/
├── src/
│   ├── ipc/              # IPC handlers
│   │   └── handlers/     # Individual handler modules
│   ├── services/         # Business logic layer
│   ├── repositories/     # Data access layer
│   ├── models/           # Domain models and entities
│   ├── types/            # TypeScript type definitions
│   ├── config/           # Configuration management
│   ├── utils/            # Shared utilities
│   ├── middleware/       # Cross-cutting concerns
│   ├── di/               # Dependency injection container
│   ├── browser/          # Browser automation (Puppeteer)
│   ├── llm/              # LLM integration
│   ├── webscraper/       # Custom web scraper
│   ├── insights/         # Insights processing
│   └── storage/          # Legacy storage (to be refactored)
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   ├── e2e/              # End-to-end tests
│   ├── fixtures/         # Test data
│   └── helpers/          # Test utilities
├── docs/
│   ├── architecture/     # Architecture documentation
│   ├── features/         # Feature specifications
│   ├── development/      # Development guides
│   └── api/              # API documentation
└── main.js               # Electron main process (legacy, being refactored)
```

## Design Principles

### 1. Separation of Concerns
- Each layer has a single, well-defined responsibility
- No business logic in IPC handlers
- No data access in services (use repositories)

### 2. Dependency Injection
- Use InversifyJS for dependency management
- Constructor injection for explicit dependencies
- Interface-based programming for testability

### 3. File Size Limits
- Maximum 500 lines per file
- Maximum 50 lines per function
- Complexity limit of 10 (cyclomatic complexity)

### 4. Type Safety
- TypeScript strict mode enabled
- No `any` types (use `unknown` and narrow)
- Zod schemas for runtime validation

### 5. Error Handling
- Custom error classes with context
- Operational vs non-operational error distinction
- Structured error logging with Winston

### 6. Testing
- 80% minimum code coverage
- Unit tests for all services and utilities
- Integration tests for repositories
- E2E tests for critical user flows

## Migration Strategy

The codebase is currently undergoing a systematic migration from a monolithic architecture to a layered, service-oriented architecture:

1. **Phase 0**: Foundation (tools, configs, structure) ✅ IN PROGRESS
2. **Phase 1**: Testing infrastructure
3. **Phase 2**: TypeScript migration (bottom-up)
4. **Phase 3**: Service extraction from main.js
5. **Phase 4**: Repository pattern implementation
6. **Phase 5**: Security and performance improvements
7. **Phase 6**: Documentation and CI/CD

See `/apps/desktop/CODEBASE_UPGRADE_PLAN.md` for detailed migration plan.

## Key Technologies

- **Runtime**: Electron 40, Node.js 20
- **Language**: TypeScript 5.9
- **UI Framework**: React 18
- **Testing**: Vitest 4
- **Browser Automation**: Puppeteer
- **LLM**: Anthropic Claude API
- **DI Container**: InversifyJS
- **Validation**: Zod
- **Logging**: Winston

## Security Considerations

- Credentials stored in system keychain (not files)
- OAuth session tokens encrypted
- No secrets in logs
- Input validation with Zod schemas
- Secure IPC communication (context isolation enabled)

## Performance Considerations

- Lazy loading of services
- Response caching (1-hour TTL)
- Background processing for insights
- Incremental updates for web scraper messages
- Database connection pooling (when applicable)
