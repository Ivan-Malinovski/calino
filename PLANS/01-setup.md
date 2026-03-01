# Plan 01: Project Setup

## Objective
Initialize the GoodCal project with proper tooling, dependencies, and project structure.

## Tech Stack
- React 18 + TypeScript + Vite
- pnpm (package manager)
- Vitest + React Testing Library (testing)
- ESLint + Prettier (linting/formatting)
- date-fns (date handling)
- chrono-node (NLP date parsing)
- tsdav (CalDAV integration)

## Implementation Steps

### 1.1 Initialize Vite Project
```bash
pnpm create vite@latest . --template react-ts
```

### 1.2 Install Core Dependencies
```bash
# Core
pnpm add react react-dom react-router-dom

# Date handling
pnpm add date-fns chrono-node

# CalDAV
pnpm add tsdav ical.js

# UI/Styling (choose one)
pnpm add clsx  # For className composition (with CSS modules)
# OR
pnpm add tailwindcss postcss autoprefixer

# State Management
pnpm add zustand

# Local Storage
pnpm add dexie

# Utilities
pnpm add uuid
```

### 1.3 Install Dev Dependencies
```bash
# Testing
pnpm add -D vitest @testing-library/react @testing-library/user-event jsdom

# Linting/Formatting
pnpm add -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-plugin-prettier

# Types
pnpm add -D @types/react @types/react-dom @types/uuid
```

### 1.4 Configure TypeScript (tsconfig.json)
- Enable strict mode
- Set up path aliases: `@/*` → `src/*`
- Enable ES2020+ target
- Enable jsx: react-jsx

### 1.5 Configure ESLint
- Extend: eslint:recommended, plugin:@typescript-eslint/recommended
- Add prettier plugin
- Set up import ordering rules

### 1.6 Configure Prettier
```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### 1.7 Configure Vitest
- Set up test environment: jsdom
- Add test match patterns: `**/*.test.ts`, `**/*.test.tsx`
- Configure coverage with v8

### 1.8 Set Up Project Structure
```
src/
├── components/
│   └── common/      # Button, Input, Modal wrappers
├── features/
│   ├── calendar/
│   ├── events/
│   ├── caldav/
│   └── nlp/
├── hooks/
├── lib/
├── types/
├── styles/
└── utils/
```

### 1.9 Create Base Components
- Button, Input, Modal (or integrate with UI library)
- Error boundary component

### 1.10 PWA/Mobile Preparation
- Plan for responsive CSS from start (use relative units: rem, em, %)
- Use semantic HTML for accessibility (screen readers work better)
- Consider CSS Grid/Flexbox for responsive layouts
- Avoid hardcoded widths - use max-width and fluid layouts
- Test on mobile/tablet sizes during development
- Future: Add vite-plugin-pwa for service worker and manifest

### 1.10 Add npm Scripts
```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "lint": "eslint src --ext .ts,.tsx",
  "lint:fix": "eslint src --ext .ts,.tsx --fix",
  "typecheck": "tsc --noEmit",
  "format": "prettier --write \"src/**/*.{ts,tsx}\"",
  "test": "vitest",
  "test:run": "vitest --run",
  "test:coverage": "vitest --coverage"
}
```

## Testing Strategy
- Write tests for utility functions (date helpers, NLP parser)
- Component tests for base UI components
- Aim for 70%+ coverage on utilities

## Dependencies to Verify
- [ ] react, react-dom
- [ ] date-fns
- [ ] chrono-node
- [ ] tsdav
- [ ] zustand (state management)
- [ ] dexie (IndexedDB persistence)
- [ ] vitest
- [ ] @testing-library/react
- [ ] eslint + prettier

## Success Criteria
- [ ] `pnpm dev` starts development server
- [ ] `pnpm build` produces production build
- [ ] `pnpm lint` passes without errors
- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm test` runs and passes
- [ ] Project structure matches specification
