# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run start` — runs `tsx index.ts` (no build step; TypeScript is executed directly).
- `docker compose up --build` — runs the container defined by `Dockerfile` + `compose.yaml`.
- No test runner or linter is configured. `npm test` is a stub that exits 1.

The process requires a `.env` at the project root with `CYTUBE_CHANNEL`, `DISCORD_TOKEN`, and `DISCORD_CHANNEL_ID` (see `.env.example`).

## Deployment

`.github/workflows/deploy.yml` SSHes into the production droplet on push-to-main and runs `git reset --hard origin/main && docker compose up -d --build` from `/root/cytube-discord-bot`. Requires repo secrets `DEPLOY_HOST` and `DEPLOY_SSH_KEY`. The droplet's `.env` lives at `/root/cytube-discord-bot/.env` (not in git, not in the image — `.dockerignore` excludes it; compose injects it via `env_file:`).

`tsx` is intentionally in `dependencies` (not `devDependencies`) because the container runs TypeScript at runtime; `npm ci --omit=dev` in the Dockerfile would otherwise strip it. `typescript` itself is a devDep — tsx uses esbuild, not tsc, at runtime.

## Architecture

The entry point `index.ts` wires two long-lived clients together:

1. `src/discord/index.ts` constructs and logs in the Discord.js `Client` at import time using `env.DISCORD_TOKEN`. The client is exported as `Client<true>` (asserting it will be ready by the time consumers use it).
2. On the Discord `ClientReady` event, `index.ts` calls `createCytubeClient()` (`src/cytube/index.ts`), which connects to a CyTube channel via the `cytube-client` package.
3. The CyTube client's `changeMedia` event is forwarded to Discord via `sendMessage` (`src/discord/sendMessage.ts`), which looks up the target text channel in `client.channels.cache` and calls `channel.send`.

The cache lookup in `sendMessage` only works because the call happens after `ClientReady` — moving it earlier will return `undefined`. The Discord client is configured with only `GatewayIntentBits.Guilds`; adding features that need message content or members will require additional intents and matching changes to the Discord bot's portal configuration.

`cytube-client` ships no types — `cytube-client.d.ts` is a stub declaring it as `any`. Event payloads (e.g. `data` in the `changeMedia` handler) are untyped; treat them as `any` and consult the cytube-client docs for shape.

`src/config/index.ts` is a thin wrapper that calls `dotenv.config()` at import and re-exports `process.env`. Anything that reads env vars should import `env` from there so dotenv is guaranteed to have run.
