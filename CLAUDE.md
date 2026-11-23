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
- `pnpm deploy-commands` — registers the `/cytube` slash command globally with Discord. The deploy workflow runs this automatically on push to `main` (one-shot `docker compose run --rm bot pnpm deploy-commands` after the rebuild), so you only need to invoke it manually when iterating on the `data` schema locally before merging. Reads `DISCORD_TOKEN` + `DISCORD_CLIENT_ID` from env.
- `pnpm typecheck` — `tsc --noEmit`. The single most useful feedback loop when editing.
- `pnpm lint` / `pnpm lint:fix` — Biome lint (read / autofix).
- `pnpm check` — Biome combined lint + format (write).
- `pnpm test` / `pnpm test:watch` — Vitest. Covers the subscriptions persistence module end-to-end (add/dedupe/remove/filtering/atomic-write, against a fresh temp DATA_DIR per test) and the CyTube manager's connection supervision (backoff, watchdog rebuilds, socket lifecycle handlers, shutdown) against a mocked `cytube-client` and fake timers. The Discord-side interaction handlers are still uncovered — mocking Discord interactions is high-effort/low-ROI.
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
- `src/cytube/manager.ts` — owns `Map<cytubeChannel, Entry>`, where an `Entry` wraps the client plus its supervision state (`retiring`, `lastConnectedAt`, `attempt`). Wires a `changeMedia` handler per client that posts "Now playing" to all subscribers. `reconcile()` opens clients for rooms in `uniqueCytubeChannels()` that aren't already running, and starts the watchdog. `shutdown()` closes every active connection and cancels queued rebuilds — called from the SIGTERM/SIGINT handler in `index.ts` so server-side CyTube connection slots free immediately on deploy rather than waiting for socket timeouts. **Self-healing (see §CyTube connection supervision).**
- `src/discord/sendMessage.ts` — `sendMessage(message, channelID)` looks up the channel in `client.channels.cache` and posts. Throws if the channel isn't cached; callers catch and log.
- `src/commands/cytube.ts` — `SlashCommandBuilder` def + `execute(…)` handler for `/cytube` + `handleButton(…)` for the unsubscribe-all confirmation button. Subcommands restricted to members with `ManageGuild`. Slash command options use `room:` for the CyTube room and `channel:` for the Discord channel.
- `src/interaction-router.ts` — single dispatch point. Routes chat-input commands and button interactions whose custom ID starts with `cytube:`. Wrapped in a top-level try/catch — discord.js emits an 'error' event on the Client when an interaction handler throws (most common cause: the 3-second interaction token expired before we replied), and an unhandled 'error' event would crash the process. Errors here are logged and swallowed.
- `src/deploy-commands.ts` — one-off script that uploads the slash command definitions to Discord via REST. **Re-run any time `src/commands/cytube.ts`'s `data` schema changes** (i.e. you add/rename/remove subcommands or options) — internal-only changes don't need it.

### Notes & gotchas

- **`cytube-client` ships no types.** `cytube-client.d.ts` is a stub declaring it as `any`. Event payloads (e.g. `data` in the `changeMedia` handler) are untyped; treat them as `any` and consult the cytube-client docs for shape.
- **`src/config/index.ts` calls `dotenv.config()` at import.** Anything that reads env vars should import `env` from there so dotenv is guaranteed to have run.
- **The cache lookup in `sendMessage` only works because calls happen after `ClientReady`** — moving them earlier returns `undefined`. The Discord client has only `GatewayIntentBits.Guilds`; new features needing message content / members require additional intents AND matching changes in the Discord Developer Portal.
- **Slash command registration is a separate one-time concern.** The bot runtime doesn't register slash commands; `pnpm deploy-commands` does. The deploy workflow runs it automatically on push to `main`, so post-merge you don't need to do anything. For local pre-merge testing, run `pnpm deploy-commands` yourself.

## CyTube connection supervision

The CyTube socket is supervised, because a silent drop once cost six months of downtime (DW-499): the bot kept its Discord gateway connection and reported `Up`, so the only symptom was messages that never arrived.

**`cytube-client` already enables socket.io reconnection** (`connect()` defaults `reconnection: true`), so the gap was never a missing retry — it was that nothing observed or supervised that retry, and socket.io alone cannot recover every failure mode:

- It re-dials the **same** socket server URL forever. CyTube hands out a per-room server via `/socketconfig/<room>.json`, so if a room moves to a different node, socket.io's retry can never succeed. Only a full rebuild through `CytubeClient.connect()` re-fetches that config.
- On `io server disconnect` it does not retry at all.

Three layers, each covering what the one above misses:

1. **Socket lifecycle handlers** (`connect`, `disconnect`, `connect_error`, `error`, `reconnect_failed`) bound to the raw `instance.socket`. We bind there rather than through `instance.on()` because cytube-client's wrapper drops extra callback args, discarding the disconnect reason and error object. Every handler logs — the outage was invisible precisely because none of this was observed.
2. **Targeted rebuilds** for the cases socket.io won't handle: `io server disconnect` and `reconnect_failed`.
3. **A watchdog** (`WATCHDOG_INTERVAL_MS`, 60s) that audits every entry and rebuilds any socket disconnected longer than `STALE_AFTER_MS` (5 min). This is the backstop: it ignores socket.io's internal state machine and just asks "has this been down too long?", so it catches wedged clients whose failure mode we haven't seen yet.

A rebuild means `retire()` (close, best-effort, then **delete from the map**) followed by a jittered exponential backoff capped at `REBUILD_MAX_MS`. Deleting the entry is load-bearing: the original bug was that a dead instance stayed in the map, so `reconcile()`'s `if (!entries.has(ch))` guard skipped it permanently and nothing short of a process restart recovered. **Treat the map as live connections only.**

Backoff resets on the `connect` event — reaching a usable connection, not merely attempting one. Pending rebuilds are tracked in `pendingRebuilds` so `shutdown()` can cancel them and so a queued rebuild can't race `reconcile()` into a second client for the same room; a rebuild that fires after its room was unsubscribed is abandoned.

## Deployment

`.github/workflows/deploy.yml` runs on push to main: a `verify` job (install/typecheck/lint/test) gates a `deploy` job that SSHes into the production droplet, runs `git reset --hard origin/main && docker compose up -d --build && docker compose run --rm bot pnpm deploy-commands` from `/root/cytube-discord-bot`, then prunes old images. Requires repo secrets `DEPLOY_HOST` and `DEPLOY_SSH_KEY`. The droplet's `.env` lives at `/root/cytube-discord-bot/.env` (not in git, not in the image — `.dockerignore` excludes it; compose injects it via `env_file:`).

On `SIGTERM`/`SIGINT` (e.g. `docker compose down`, container stop, redeploy), `index.ts` closes every CyTube WebSocket and destroys the Discord client before exiting. This avoids leaving phantom server-side connections that can rate-limit reconnects when several rooms come back at once on the next deploy.

The subscription store (`data/subscriptions.json`) lives in a named Docker volume (`cytube-data`), declared in `compose.yaml`. Volume contents persist across `docker compose up --build`; only `docker volume rm cytube-data` will wipe them.

`tsx` is intentionally in `dependencies` (not `devDependencies`) because the container runs TypeScript at runtime; `pnpm install --prod --frozen-lockfile` in the Dockerfile would otherwise strip it. `typescript` itself is a devDep — tsx uses esbuild, not tsc, at runtime.
