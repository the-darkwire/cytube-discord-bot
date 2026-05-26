# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Org-wide conventions (toolchain, script vocabulary, style, deploy patterns, Node version policy) live in [`org-conventions.md`](./org-conventions.md) — vendored from <https://github.com/the-darkwire/conventions>. This file covers what's specific to cytube-discord-bot.

## What this is

A multi-tenant Discord bot that forwards CyTube media-change events into Discord text channels. Discord server admins use `/cytube subscribe <channel>` to bind a Discord text channel to a CyTube channel; the bot opens one CyTube connection per unique channel and fans out media-change events to all subscribed Discord channels.

One deployment serves any number of Discord servers — same model as roggan-bot.

## Commands

Package manager is **pnpm** (the-darkwire org standard). Runtime executor is **tsx** (no build step; `tsconfig.json` has `noEmit: true`).

- `pnpm dev` / `pnpm start` — runs the bot via `tsx index.ts`. Identical commands.
- `pnpm deploy-commands` — registers the `/cytube` slash command globally with Discord. Run once after first deploy, and again any time `src/commands/cytube.ts` `data` changes (i.e. add/rename/remove subcommands or options). Reads `DISCORD_TOKEN` + `DISCORD_CLIENT_ID` from env; does not require the bot to be running.
- `pnpm typecheck` — `tsc --noEmit`. The single most useful feedback loop when editing.
- `pnpm lint` / `pnpm lint:fix` — Biome lint (read / autofix).
- `pnpm check` — Biome combined lint + format (write).
- `pnpm test` — Vitest smoke test.
- `docker compose up --build` — runs the container defined by `Dockerfile` + `compose.yaml`.

## Env

Required:

- `DISCORD_TOKEN` — bot auth token

For `pnpm deploy-commands` only (one-time):

- `DISCORD_CLIENT_ID` — Discord application ID

Legacy (optional, used only for migrating the older env-based single-tenant config; see §Architecture):

- `CYTUBE_CHANNEL`
- `DISCORD_CHANNEL_ID`

## Persistence

Subscriptions live in `data/subscriptions.json` (gitignored). The path is overridable via `DATA_DIR` (defaults to `./data`). In Docker, this is mounted as a named volume (`cytube-data`) so the file survives container rebuilds across deploys.

## Architecture

The entry point `index.ts` orchestrates:

1. `src/discord/index.ts` constructs and logs in the Discord.js `Client` at import time using `env.DISCORD_TOKEN`. The client is exported as `Client<true>` (asserting it will be ready by the time consumers use it). Only `GatewayIntentBits.Guilds` is enabled.
2. On the Discord `ClientReady` event, `index.ts`:
   - Calls `subscriptions.init()` to load `data/subscriptions.json` into memory.
   - **Auto-migrates** the legacy env-based single subscription into the JSON store: if the store is empty AND `env.CYTUBE_CHANNEL` + `env.DISCORD_CHANNEL_ID` are set, it seeds one subscription. The env vars are unnecessary after this and can be removed on the next deploy.
   - Calls `cytubeManager.reconcile()` to open a CyTube client for every unique CyTube channel in the store.
3. On `InteractionCreate`, `src/interaction-router.ts` dispatches to `src/commands/cytube.ts`, which handles `/cytube subscribe | unsubscribe | list`.

When a CyTube client fires `changeMedia`:
- `cytubeManager` looks up all `Subscription` rows for that CyTube channel and calls `sendMessage(message, sub.discordChannelId)` for each. Send failures are logged but don't crash the process.

### Modules

- `src/persistence/subscriptions.ts` — JSON file at `data/subscriptions.json`. In-memory cache; atomic writes via tmp + rename. CRUD helpers: `init`, `getAll`, `getByGuild`, `getByCytubeChannel`, `findByChannel`, `add`, `remove`, `uniqueCytubeChannels`.
- `src/cytube/manager.ts` — owns the `Map<cytubeChannel, CytubeInstance>`. `reconcile()` opens clients for channels in `uniqueCytubeChannels()` that aren't already running. Idle clients are left running (hobby-scale shortcut; bot restart on deploy resets the world).
- `src/discord/sendMessage.ts` — `sendMessage(message, channelID)` looks up the channel in `client.channels.cache` and posts. Throws if the channel isn't cached; callers catch and log.
- `src/commands/cytube.ts` — `SlashCommandBuilder` def + execute handler for the `/cytube` subcommand tree. Subcommands restricted to members with `ManageGuild` (so random users can't spam-subscribe a channel).
- `src/interaction-router.ts` — single dispatch point for slash commands (mirrors roggan-bot's pattern).
- `src/deploy-commands.ts` — one-off script that uploads the slash command definitions to Discord via REST.

### Notes & gotchas

- **`cytube-client` ships no types.** `cytube-client.d.ts` is a stub declaring it as `any`. Event payloads (e.g. `data` in the `changeMedia` handler) are untyped; treat them as `any` and consult the cytube-client docs for shape.
- **`src/config/index.ts` calls `dotenv.config()` at import.** Anything that reads env vars should import `env` from there so dotenv is guaranteed to have run.
- **The cache lookup in `sendMessage` only works because calls happen after `ClientReady`** — moving them earlier returns `undefined`. The Discord client has only `GatewayIntentBits.Guilds`; new features needing message content / members require additional intents AND matching changes in the Discord Developer Portal.
- **Slash command registration is a separate one-time concern.** The bot runtime doesn't register slash commands; `pnpm deploy-commands` does. After a definition change in `src/commands/cytube.ts`, re-run `deploy-commands` or the new options won't appear in Discord.

## Deployment

`.github/workflows/deploy.yml` SSHes into the production droplet on push-to-main and runs `git reset --hard origin/main && docker compose up -d --build` from `/root/cytube-discord-bot`. Requires repo secrets `DEPLOY_HOST` and `DEPLOY_SSH_KEY`. The droplet's `.env` lives at `/root/cytube-discord-bot/.env` (not in git, not in the image — `.dockerignore` excludes it; compose injects it via `env_file:`).

The subscription store (`data/subscriptions.json`) lives in a named Docker volume (`cytube-data`), declared in `compose.yaml`. Volume contents persist across `docker compose up --build`; only `docker volume rm cytube-data` will wipe them.

`tsx` is intentionally in `dependencies` (not `devDependencies`) because the container runs TypeScript at runtime; `pnpm install --prod --frozen-lockfile` in the Dockerfile would otherwise strip it. `typescript` itself is a devDep — tsx uses esbuild, not tsc, at runtime.
