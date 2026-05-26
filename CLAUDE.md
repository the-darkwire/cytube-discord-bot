# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Org-wide conventions (toolchain, script vocabulary, style, deploy patterns, Node version policy) live in [`org-conventions.md`](./org-conventions.md) — vendored from <https://github.com/the-darkwire/conventions>. This file covers what's specific to cytube-discord-bot.

## Commands

Package manager is **pnpm** (the-darkwire org standard). Runtime executor is **tsx** (no build step; `tsconfig.json` has `noEmit: true`).

- `pnpm dev` / `pnpm start` — runs the bot via `tsx index.ts`. Identical commands; `start` is the production entry, `dev` exists for parity with other org repos.
- `pnpm typecheck` — `tsc --noEmit`. The single most useful feedback loop when editing.
- `pnpm lint` / `pnpm lint:fix` — Biome lint (read / autofix).
- `pnpm format` — Biome format (write).
- `pnpm check` — Biome combined lint + format (write).
- `pnpm test` / `pnpm test:watch` — Vitest. Currently only a smoke test exists.
- `docker compose up --build` — runs the container defined by `Dockerfile` + `compose.yaml`.

The process requires a `.env` at the project root with `CYTUBE_CHANNEL`, `DISCORD_TOKEN`, and `DISCORD_CHANNEL_ID` (see `.env.example`).

Style is enforced by `biome.json` at the repo root (org-wide convention): double quotes, semicolons, trailing commas everywhere, 2-space indent, 100-char lines, organized imports. Run `pnpm check` to autofix everything in one shot.

## Deployment

`.github/workflows/deploy.yml` SSHes into the production droplet on push-to-main and runs `git reset --hard origin/main && docker compose up -d --build` from `/root/cytube-discord-bot`. Requires repo secrets `DEPLOY_HOST` and `DEPLOY_SSH_KEY`. The droplet's `.env` lives at `/root/cytube-discord-bot/.env` (not in git, not in the image — `.dockerignore` excludes it; compose injects it via `env_file:`).

`tsx` is intentionally in `dependencies` (not `devDependencies`) because the container runs TypeScript at runtime; `pnpm install --prod --frozen-lockfile` in the Dockerfile would otherwise strip it. `typescript` itself is a devDep — tsx uses esbuild, not tsc, at runtime.

## Architecture

The entry point `index.ts` wires two long-lived clients together:

1. `src/discord/index.ts` constructs and logs in the Discord.js `Client` at import time using `env.DISCORD_TOKEN`. The client is exported as `Client<true>` (asserting it will be ready by the time consumers use it).
2. On the Discord `ClientReady` event, `index.ts` calls `createCytubeClient()` (`src/cytube/index.ts`), which connects to a CyTube channel via the `cytube-client` package.
3. The CyTube client's `changeMedia` event is forwarded to Discord via `sendMessage` (`src/discord/sendMessage.ts`), which looks up the target text channel in `client.channels.cache` and calls `channel.send`.

The cache lookup in `sendMessage` only works because the call happens after `ClientReady` — moving it earlier will return `undefined`. The Discord client is configured with only `GatewayIntentBits.Guilds`; adding features that need message content or members will require additional intents and matching changes to the Discord bot's portal configuration.

`cytube-client` ships no types — `cytube-client.d.ts` is a stub declaring it as `any`. Event payloads (e.g. `data` in the `changeMedia` handler) are untyped; treat them as `any` and consult the cytube-client docs for shape.

`src/config/index.ts` is a thin wrapper that calls `dotenv.config()` at import and re-exports `process.env`. Anything that reads env vars should import `env` from there so dotenv is guaranteed to have run.
