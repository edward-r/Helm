# AGENTS

This file guides agentic coding assistants working in this repo.
Follow existing patterns and keep changes consistent with current architecture.

## Repository overview

- Electron + React + TypeScript app built with electron-vite.
- Main process code: src/main
- Preload bridge: src/preload
- Renderer UI: src/renderer/src
- Shared types + tRPC: src/shared
- Build config: electron.vite.config.ts, electron-builder.yml
- Formatting and linting: .prettierrc.yaml, eslint.config.mjs

## Install / run / build

- Install deps: npm install
- Dev (hot reload): npm run dev
- Preview built app: npm run start
- Typecheck all: npm run typecheck
- Typecheck main only: npm run typecheck:node
- Typecheck renderer only: npm run typecheck:web
- Lint: npm run lint
- Format: npm run format
- Build (typecheck + bundle): npm run build
- Package (dir): npm run build:unpack
- Package (macOS): npm run build:mac
- Package (Windows): npm run build:win
- Package (Linux): npm run build:linux

## Tests

- No test runner or test scripts are configured.
- No test files are present (no **tests** or *.test/*spec files).
- Single-test command: not available until a test runner is added.
- If you add tests, update this section with the exact per-test CLI.

## Formatting and linting

- Prettier: singleQuote true, semi false, printWidth 100, trailingComma none.
- ESLint: @electron-toolkit configs + react hooks + react-refresh; Prettier disables formatting rules.
- Use 2-space indentation (Prettier default).
- Keep files formatted via npm run format before committing.

## TypeScript conventions

- Do not use the any type; prefer unknown with narrowing.
- Prefer type aliases for object shapes and unions (type Foo = ...).
- Use import type for type-only imports.
- Add explicit return types for exported functions where clarity helps.
- Use discriminated unions with ok: true/false for result objects.
- Favor Record<string, unknown> for generic objects and guard with isRecord.
- Keep Zod schemas in sync with exported types in src/shared/trpc.ts.

## Functional style

- Prefer functions and small helpers over classes.
- Use const for functions; use let only when reassignment is required.
- Favor pure functions where possible; keep side effects localized.

## Imports and modules

- Use node: prefixed imports for Node built-ins (node:fs, node:path, etc.).
- Group imports: node built-ins, external packages, internal modules; separate groups with blank lines.
- Keep relative imports short; use path aliases when configured.
- Renderer alias: `@renderer/*` -> `src/renderer/src/*`
- Main alias: `@prompt-maker/core` and `@prompt-maker/core/*` -> `src/main/core`
- Shared types live in src/shared; import them from there instead of duplicating.

## Naming conventions

- React components use PascalCase and live in src/renderer/src/components.
- Component files are PascalCase (InputPanel.tsx).
- Hooks use the useX pattern (useAgentStore).
- Main process files use kebab-case (tool-call-parser.ts).
- Constants use SCREAMING_SNAKE_CASE for defaults (DEFAULT_MODEL).
- Type names use PascalCase; input/result types use FooInput/FooResult.

## Renderer / React patterns

- Use function components (no class components).
- Default-export components from their files (see App.tsx).
- Use hooks like useCallback for stable handlers passed to children.
- Keep JSX simple; compute derived values above the return.
- Zustand store (src/renderer/src/store/useAgentStore.ts) is the main state hub.
- Update state with set/get from zustand; use selectors to avoid extra renders.
- For async UI actions, catch errors and surface a friendly message.
- When ignoring promises in event handlers, use void to signal intent.

## Styling (renderer)

- CSS lives in src/renderer/src/assets and is imported from src/renderer/src/main.tsx.
- Prefer className-based styling; avoid inline styles unless trivial.
- Keep class names consistent with existing BEM-like patterns (input-panel, message-bubble).
- Add new styles to main.css or base.css instead of scattering new files.

## Main process / tooling patterns

- Tool definitions implement AgentTool with name, description, inputSchema, execute.
- Tool schemas are JsonSchema objects with additionalProperties: false.
- Tools should return ok: true/false result objects, not throw.
- Use buildToolExecutionEnvelope + serializeToolExecutionEnvelope for tool results.
- Keep tool registry in sync (ALL_TOOLS) and validate names/uniqueness.
- Prefer deterministic ordering (e.g., list_dir sorts entries).
- Normalize tool input early (see normalizeReadFileInput in fs tool).

## Electron security and preload

- Keep contextIsolation enabled and nodeIntegration disabled unless there is a strong reason.
- Use contextBridge in src/preload/index.ts to expose safe APIs to the renderer.
- When adding preload APIs, update src/preload/index.d.ts for window types.
- Avoid @ts-ignore where possible; prefer updating type declarations.
- IPC for tRPC uses the electron-trpc channel; keep it stable.

## Error handling

- Normalize caught errors with error instanceof Error ? error.message : '...'.
- Attach structured error codes and details where helpful.
- Avoid leaking raw errors into UI; map to user-friendly messages.
- For tool IO errors, include stdout/stderr/exitCode when available.
- For API errors, return typed errors and keep message strings consistent.

## tRPC / API

- Router lives in src/shared/trpc.ts and is shared between main/renderer.
- Update zod schemas and exported types together.
- Renderer uses createTRPCProxyClient + ipcLink (src/renderer/src/trpc.ts).
- When adding endpoints, update AppRouter and IPC handlers in src/main/index.ts.

## Working with attachments

- Attachments are passed through ExecutorRunInput.attachments as file paths.
- PDF/image handling lives in src/main/agent/executor.ts; extend there for new types.
- Keep attachment parsing deterministic and avoid large synchronous reads.

## File I/O guidelines

- Use path.resolve(process.cwd(), inputPath) for user-provided paths.
- Validate inputs and return typed errors instead of throwing.
- Preserve existing behavior of create_dirs defaulting to true in write_file.

## Files worth reading first

- src/main/index.ts (main process boot + IPC wiring)
- src/main/agent/executor.ts (core execution loop)
- src/shared/trpc.ts (shared types + router)
- src/renderer/src/store/useAgentStore.ts (UI state + execution)
- src/renderer/src/components (UI building blocks)

## Cursor/Copilot rules

- No .cursor/rules/, .cursorrules, or .github/copilot-instructions.md found.
