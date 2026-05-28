# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Org-wide conventions (toolchain, script vocabulary, style, deploy patterns, Node version policy) live in [`org-conventions.md`](./org-conventions.md) — vendored from <https://github.com/the-darkwire/conventions>. This file covers what's specific to cytube-discord-bot.

## What this is

A multi-tenant Discord bot that forwards CyTube media-change events into Discord text channels. Discord server admins use `/cytube subscribe room:<name>` to bind a Discord channel to a CyTube room; the bot opens one CyTube connection per unique room and fans out media-change events to all subscribed Discord channels.

Many-to-many: one Discord channel can subscribe to multiple CyTube rooms, and one CyTube room can forward to multiple Discord channels across multiple Discord servers. The persistence layer dedupes on `(discordChannelId, cytubeChannel)` pairs, so subscribing to something you're already subscribed to is a no-op.

A per-video Discord thread + CyTube chat mirror feature was previously shipped and then removed (see commit `bdc9f3a` for the implementation if it's ever brought back). The bot's invite URL still asks for "Create Public Threads" and "Send Messages in Threads" so re-enabling won't need a re-invite.

Naming convention in the slash commands: **`room:`** for the CyTube side (matches CyTube's URL terminology `cytu.be/r/<room>`), **`channel:`** for the Discord side (Discord's term, reinforced by the channel-picker UI).

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
3. On `InteractionCreate`, `src/interaction-router.ts` dispatches:
   - Chat input commands (`/cytube …`) → `src/commands/cytube.ts` `execute(…)`.
   - Button clicks whose custom ID starts with `cytube:` → `src/commands/cytube.ts` `handleButton(…)`. Currently only one button exists: the "Unsubscribe all N" confirmation surfaced when `/cytube unsubscribe` is invoked on a channel with multiple subs.

When a CyTube client fires `changeMedia`:
- `cytubeManager` looks up all `Subscription` rows for that CyTube channel and calls `sendMessage(message, sub.discordChannelId)` for each. Failures are logged but don't crash the process.

### Modules

- `src/persistence/subscriptions.ts` — JSON file at `data/subscriptions.json`. In-memory cache; atomic writes via tmp + rename. Dedupe key is `(discordChannelId, cytubeChannel)`. Helpers: `init`, `getAll`, `getByGuild`, `getByCytubeChannel`, `getByChannel`, `add`, `removeOne(channelId, cytubeChannel)`, `removeAllForChannel(channelId)`, `uniqueCytubeChannels`.
- `src/cytube/manager.ts` — owns the `Map<cytubeChannel, CytubeInstance>`. Wires a `changeMedia` handler per client that posts "Now playing" to all subscribers. `reconcile()` opens clients for rooms in `uniqueCytubeChannels()` that aren't already running. Idle clients are left running (hobby-scale shortcut; bot restart on deploy resets the world).
- `src/discord/sendMessage.ts` — `sendMessage(message, channelID)` looks up the channel in `client.channels.cache` and posts. Throws if the channel isn't cached; callers catch and log.
- `src/commands/cytube.ts` — `SlashCommandBuilder` def + `execute(…)` handler for `/cytube` + `handleButton(…)` for the unsubscribe-all confirmation button. Subcommands restricted to members with `ManageGuild`. Slash command options use `room:` for the CyTube room and `channel:` for the Discord channel.
- `src/interaction-router.ts` — single dispatch point. Routes chat-input commands and button interactions whose custom ID starts with `cytube:`. Wrapped in a top-level try/catch — discord.js emits an 'error' event on the Client when an interaction handler throws (most common cause: the 3-second interaction token expired before we replied), and an unhandled 'error' event would crash the process. Errors here are logged and swallowed.
- `src/deploy-commands.ts` — one-off script that uploads the slash command definitions to Discord via REST. **Re-run any time `src/commands/cytube.ts`'s `data` schema changes** (i.e. you add/rename/remove subcommands or options) — internal-only changes don't need it.

### Notes & gotchas

- **`cytube-client` ships no types.** `cytube-client.d.ts` is a stub declaring it as `any`. Event payloads (e.g. `data` in the `changeMedia` handler) are untyped; treat them as `any` and consult the cytube-client docs for shape.
- **`src/config/index.ts` calls `dotenv.config()` at import.** Anything that reads env vars should import `env` from there so dotenv is guaranteed to have run.
- **The cache lookup in `sendMessage` only works because calls happen after `ClientReady`** — moving them earlier returns `undefined`. The Discord client has only `GatewayIntentBits.Guilds`; new features needing message content / members require additional intents AND matching changes in the Discord Developer Portal.
- **Slash command registration is a separate one-time concern.** The bot runtime doesn't register slash commands; `pnpm deploy-commands` does. After a definition change in `src/commands/cytube.ts`, re-run `deploy-commands` or the new options won't appear in Discord.

## Deployment

`.github/workflows/deploy.yml` SSHes into the production droplet on push-to-main and runs `git reset --hard origin/main && docker compose up -d --build` from `/root/cytube-discord-bot`. Requires repo secrets `DEPLOY_HOST` and `DEPLOY_SSH_KEY`. The droplet's `.env` lives at `/root/cytube-discord-bot/.env` (not in git, not in the image — `.dockerignore` excludes it; compose injects it via `env_file:`).

The subscription store (`data/subscriptions.json`) lives in a named Docker volume (`cytube-data`), declared in `compose.yaml`. Volume contents persist across `docker compose up --build`; only `docker volume rm cytube-data` will wipe them.

`tsx` is intentionally in `dependencies` (not `devDependencies`) because the container runs TypeScript at runtime; `pnpm install --prod --frozen-lockfile` in the Dockerfile would otherwise strip it. `typescript` itself is a devDep — tsx uses esbuild, not tsc, at runtime.
