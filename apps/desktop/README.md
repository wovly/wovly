# Wovly Desktop

> Your autonomous communication agent - AI assistant for Email, Slack, iMessage, and custom websites

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Development

See [Development Guide](./docs/development/GETTING_STARTED.md) for detailed setup instructions.

### Essential Commands

```bash
npm run type-check      # TypeScript type checking
npm run lint           # Check code quality
npm run lint:fix       # Auto-fix linting issues
npm test               # Run tests
npm run test:coverage  # Generate coverage report
npm run format         # Format code with Prettier
```

### Code Quality Standards

- ✅ TypeScript strict mode
- ✅ 80% minimum test coverage
- ✅ 500 line maximum per file
- ✅ ESLint with zero warnings
- ✅ Prettier formatting enforced

See [CLAUDE.md](./CLAUDE.md) for complete coding standards.

## Architecture

Wovly follows a layered architecture with dependency injection:

```
UI Layer (React)
    ↓
IPC Layer (Electron)
    ↓
Service Layer (Business Logic)
    ↓
Repository Layer (Data Access)
    ↓
Storage Layer (Files/DB)
```

See [Architecture Documentation](./docs/architecture/README.md) for details.

## Features

- 📧 **Email Integration**: Gmail message analysis and insights
- 💬 **Slack Integration**: Team communication monitoring
- 📱 **iMessage Integration**: Personal message access
- 🌐 **Custom Web Scraping**: Extract data from websites without APIs
- 🤖 **AI Task Execution**: Architect-builder model for complex workflows
- 🧠 **Long-term Memory**: Context retention across sessions
- 📊 **Insights Generation**: Daily summaries and action items

## Project Structure

```
apps/desktop/
├── src/              # Source code
├── tests/            # Test suites
├── docs/             # Documentation
├── main.js           # Electron main process (legacy)
├── preload.js        # Preload script
└── package.json
```

## Testing

```bash
npm test                 # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run test:ui         # Open Vitest UI
```

Minimum coverage requirement: 80%

## Building

```bash
npm run build          # Build app + UI
npm run build:mac      # Build for macOS
npm run build:win      # Build for Windows
npm run build:linux    # Build for Linux
```

## Contributing

1. Follow the coding standards in [CLAUDE.md](./CLAUDE.md)
2. Write tests for all new code (80% coverage minimum)
3. Run pre-commit checks: `npm run type-check && npm run lint && npm test`
4. Keep files under 500 lines
5. Document public APIs

## Migration Status

🚧 **Active Refactoring**: This codebase is undergoing a systematic migration from monolithic to service-oriented architecture.

- ✅ Phase 0: Foundation (tools, configs, structure)
- 🔄 Phase 1: Testing infrastructure
- ⏳ Phase 2: TypeScript migration
- ⏳ Phase 3: Service extraction

See [Codebase Upgrade Plan](./CODEBASE_UPGRADE_PLAN.md) for details.

## Technology Stack

- **Runtime**: Electron 40, Node.js 20
- **Language**: TypeScript 5.9
- **UI**: React 18
- **Testing**: Vitest 4
- **Browser Automation**: Puppeteer
- **AI**: Anthropic Claude API
- **DI**: InversifyJS
- **Logging**: Winston
- **Validation**: Zod

## License

Private - All rights reserved

## Support

For issues or questions, please check the documentation in `/docs` or create an issue.
