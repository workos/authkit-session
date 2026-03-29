# Contract: Migrate from Prettier to oxfmt and add oxlint

## Problem

The repo currently uses Prettier for formatting and has no linter configured (ESLint was never installed, the CI lint step is commented out). We want to switch to the faster oxc toolchain — oxfmt for formatting and oxlint for linting.

## Goals

1. Replace Prettier with oxfmt, preserving the existing formatting style (single quotes, trailing commas, semicolons, avoid arrow parens, 2-space indent).
2. Add oxlint as the project linter with sensible defaults for a TypeScript library.
3. Update package.json scripts and CI workflow to use the new tools.
4. Format all source files with oxfmt so the codebase is clean on merge.

## Success Criteria

- `pnpm run format:check` passes (oxfmt --check)
- `pnpm run lint` passes (oxlint)
- `pnpm run build` still succeeds
- `pnpm run test` still passes
- CI workflow uses the new tools
- No prettier dependency or config files remain

## Scope

### In Scope

- Remove prettier devDependency, `prettier.config.js`, `.prettierignore`
- Add oxfmt and oxlint as devDependencies
- Create `.oxfmtrc.json` with migrated prettier settings
- Create `.oxlintrc.json` with reasonable defaults (correctness + suspicious categories)
- Update package.json scripts
- Update `.github/workflows/ci.yml` to run oxfmt check and oxlint
- Reformat all source files with oxfmt

### Out of Scope

- Adding new lint rules beyond sensible defaults
- Changing any application logic
- Modifying test assertions (beyond formatting)

## Phases

Single phase — this is a straightforward tooling swap.
