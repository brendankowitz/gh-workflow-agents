# Contributing to GH-Agency

Thank you for your interest in contributing to GH-Agency! This document provides guidelines and information for contributors.

## Development Setup

### Prerequisites

- Node.js 20 or later
- npm (comes with Node.js)
- Git

### Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/your-username/gh-workflow-agents.git
   cd gh-workflow-agents
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Project Structure

```
gh-workflow-agents/
├── actions/              # GitHub Action definitions (action.yml files)
├── src/
│   ├── shared/           # Shared utilities (sanitization, validation, etc.)
│   ├── sdk/              # SDK wrappers (GitHub API, Copilot client)
│   └── actions/          # Agent implementations
├── examples/             # Example workflow files
└── docs/                 # Documentation
```

## Code Standards

### TypeScript

- Strict mode enabled
- Explicit return types on public functions
- JSDoc comments for public APIs

### Security

GH-Agency is security-first software. All contributions must:

- Sanitize any user input before processing
- Validate outputs against allowlists
- Never trust content from issues or PRs
- Follow the trust boundary patterns established in the codebase

### Style

- Use Prettier for formatting
- Follow ESLint rules
- Prefer explicit over implicit
- Write clear, descriptive variable names

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Add tests for new functionality
4. Update documentation if needed
5. Ensure all tests pass
6. Submit a pull request

### Commit Messages

Follow conventional commits format:

```
type(scope): description

[optional body]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(triage): add duplicate detection`
- `fix(sanitizer): handle unicode edge cases`
- `docs(readme): update installation instructions`

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Writing Tests

- Place tests next to source files with `.test.ts` extension
- Test edge cases and error conditions
- Mock external dependencies

## Security Issues

If you discover a security vulnerability, please report it privately via GitHub's security advisory feature. Do not open a public issue.

## Questions?

Open a discussion on GitHub or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
