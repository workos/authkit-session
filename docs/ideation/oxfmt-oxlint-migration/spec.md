# Spec: Migrate from Prettier to oxfmt and add oxlint

## Overview

Replace Prettier with oxfmt for formatting and add oxlint as the linter. Single phase, mechanical changes.

## Step 1: Remove Prettier

### Files to delete

- `prettier.config.js`
- `.prettierignore`

### package.json changes

- Remove `prettier` from `devDependencies`
- Remove the `prettier` and `format` scripts (will be replaced in Step 3)

## Step 2: Add oxfmt and oxlint

### Install

```bash
pnpm add -D oxfmt oxlint
```

### Create `.oxfmtrc.json`

Create at repo root with these settings (migrated from the existing prettier config):

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "avoid",
  "useTabs": false,
  "tabWidth": 2,
  "singleQuote": true,
  "printWidth": 80,
  "ignorePatterns": ["pnpm-lock.yaml", "package-lock.json", "dist"]
}
```

### Create `.oxlintrc.json`

Create at repo root with sensible defaults for a TypeScript library:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  },
  "ignorePatterns": ["dist", "coverage", "node_modules"]
}
```

## Step 3: Update package.json scripts

Replace the formatting scripts and add lint:

```json
{
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsc -p tsconfig.build.json",
    "rebuild": "pnpm run clean && pnpm run build",
    "dev": "tsc -p tsconfig.build.json --watch",
    "prepack": "npm run rebuild",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "lint": "oxlint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "test:coverage": "vitest --run --coverage",
    "test:watch": "vitest --watch"
  }
}
```

Key changes:

- `prettier` script → `format:check` (using `oxfmt --check .`)
- `format` script now uses `oxfmt --write .`
- New `lint` script using `oxlint .`

## Step 4: Update CI workflow

Edit `.github/workflows/ci.yml`:

Replace the Prettier step:

```yaml
- name: Format Check
  run: |
    pnpm run format:check
```

Uncomment and update the Lint step:

```yaml
- name: Lint
  run: |
    pnpm run lint
```

## Step 5: Format all files

Run `pnpm run format` to reformat all source files with oxfmt so the repo is clean.

## Validation

Run these commands to verify everything works:

```bash
pnpm run format:check   # Should pass (all files formatted)
pnpm run lint            # Should pass (no lint errors)
pnpm run build           # Should still compile
pnpm run test            # Should still pass
pnpm run typecheck       # Should still pass
```

Also verify removed files:

```bash
test ! -f prettier.config.js && echo "PASS: prettier config removed"
test ! -f .prettierignore && echo "PASS: prettierignore removed"
! grep -q '"prettier"' package.json && echo "PASS: prettier dep removed"
```
