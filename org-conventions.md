# the-darkwire conventions

The-Darkwire's shared TypeScript toolchain. All org repos follow these to minimize context-switching overhead when moving between projects. The source-of-truth lives at <https://github.com/the-darkwire/conventions>; this file is vendored into each consumer repo.

## Toolchain

- **Language**: TypeScript (all repos)
- **Package manager**: pnpm (`packageManager` field pinned in `package.json`)
- **Linter/formatter**: Biome (`biome.json` at repo root, copied from the canon)
- **Type checking**: `tsc --noEmit` (no build step for runnable repos that use tsx/Bun/Vite/Metro/etc.)
- **Tests**: Vitest (every repo ships at minimum a smoke test so `pnpm test` exits 0)
- **Node**: pinned via `.nvmrc`, kept in sync with Dockerfile / CI matrix. Repos that use **Bun** as the runtime (e.g. the `elysia-stack` template) pin Bun via `engines.bun` in `package.json` instead and do not have `.nvmrc`. **pnpm remains the package manager regardless of runtime** — Bun's resolver handles pnpm-installed `node_modules` cleanly.

## Standardized script vocabulary

Every repo exposes these scripts. The underlying command differs by project type; the *interface* is uniform. This is the single biggest context-switch reducer.

| Script | Meaning |
|---|---|
| `pnpm dev` | Run the project locally (with HMR/watch where applicable) |
| `pnpm start` | Production entry. For bots without a build step this is identical to `dev`. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome lint .` |
| `pnpm lint:fix` | `biome lint --write .` |
| `pnpm format` | `biome format --write .` |
| `pnpm check` | `biome check --write .` (combined lint + format) |
| `pnpm test` | `vitest run` |
| `pnpm test:watch` | `vitest` |
| `pnpm build` | Produce production artifacts. Omitted in repos that have no build step. |

Stack-specific scripts (e.g. `pnpm deploy-commands` for Discord bots) are fine on top of these — the table is the floor, not the ceiling.

## Style conventions (enforced by `biome.json`)

- Double quotes
- Semicolons required
- Trailing commas everywhere
- 2-space indent
- 100-char line width
- Organized imports on save
- `import type` for type-only imports (warn)
- `node:` protocol for built-ins (warn)
- No explicit `any` (error) — use an inline `// biome-ignore lint/suspicious/noExplicitAny: <reason>` when wrapping untyped third-party APIs

Run `pnpm check` to autofix everything Biome can.

## pnpm conventions

- Commit `pnpm-lock.yaml`
- Use `pnpm-workspace.yaml` for `allowBuilds` entries (postinstall scripts are opt-in in pnpm 11+). See `pnpm-workspace.yaml.example` in the conventions repo.
- Set the `packageManager` field in `package.json` to pin the pnpm version (matches what corepack will activate inside Docker)
- Use `pnpm install --prod --frozen-lockfile` in Dockerfiles; `pnpm install --frozen-lockfile` in CI

## Node version policy

Pin the exact version in `.nvmrc`. Match the Dockerfile's `ARG NODE_VERSION`. Bump deliberately, not casually.

Current org-wide version: **24.15.0**.

## tsconfig baseline

Repos extend `tsconfig.base.json` from the conventions repo (vendor a copy into the repo root) and add per-project specifics:

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext"],   // bots/backends; add "DOM" for browser apps
    "noEmit": true        // runnable repos without a build step
  }
}
```

The base sets `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, modern module resolution (`Preserve` + `bundler`). It deliberately omits `lib` and `noEmit` since those vary by project type.

## Deploy patterns

### SSH-to-droplet (bots)

Both current Discord bots deploy via GH Actions SSHing into a droplet and running `git reset --hard origin/main && docker compose up -d --build`. Repo secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`. `.env` lives on the droplet (not in git, not in the image). See either bot's `.github/workflows/deploy.yml` for the canonical pattern.

### Future stacks

Backends, mobile apps, web frontends will land their own deploy patterns. Document each one here as it stabilizes.

## CLAUDE.md structure

Each repo's `CLAUDE.md` should:
- Briefly describe the project (what it is, how it runs locally)
- Document architecture decisions specific to this repo
- Note any gotchas Claude (or humans) need to know
- Reference this `org-conventions.md` for toolchain norms (no need to repeat the contents)

## Maintenance

Updates to this document are made in <https://github.com/the-darkwire/conventions>. Consumer repos vendor a copy; refresh from the source-of-truth when meaningful changes land. When the friction of copying gets annoying, we'll publish as `@the-darkwire/conventions` on npm and switch consumers to `extends`.
