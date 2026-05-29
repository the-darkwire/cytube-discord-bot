# cytube-discord-bot

A multi-tenant Discord bot that forwards CyTube media-change events into Discord text channels. Server admins bind any number of Discord channels to any number of CyTube rooms via a `/cytube` slash command; the bot does the rest. One deployment handles any number of Discord servers.

## Server Owners

Want the bot in your Discord server? **[→ Invite cytube-bot](https://discord.com/api/oauth2/authorize?client_id=1249189441700892724&scope=bot+applications.commands&permissions=294205262848)**

**What it does once installed:**

- Posts a message in whichever Discord text channel you subscribe, every time the linked CyTube room changes media (e.g. a new YouTube video starts).
- Supports many-to-many: one Discord channel can follow several CyTube rooms; one CyTube room can fan out to several Discord channels (even across servers).

**Required Discord bot permissions:**

- View Channels
- Send Messages
- Use Application Commands

The invite link also requests `Create Public Threads` and `Send Messages in Threads`. These powered a per-video chat-mirror feature that's currently disabled but may return; keeping them in the invite avoids the need to re-invite the bot to grant them later. They are unused by the bot today.

Invite scopes: `bot` + `applications.commands`. The bot is configured with only the `Guilds` gateway intent — no privileged intents like `Message Content` or `Server Members`.

**Setup checklist:**

1. Click the invite link above and pick a server you administer.
2. Run the slash commands in any text channel (see the command reference below).

`/cytube subscribe` and `/cytube unsubscribe` require the **Manage Server** permission. `/cytube list` is available to everyone.

### Command reference

`room:` is the CyTube room name — the bit after `/r/` in the CyTube URL (e.g. for `https://cytu.be/r/myroom`, use `myroom`). `channel:` is a Discord channel picker.

```
/cytube subscribe   room:<name> [channel:<#discord-channel>]
/cytube unsubscribe [room:<name>] [channel:<#discord-channel>]
/cytube list
```

**`/cytube subscribe`** — binds a CyTube room to a Discord channel. If `channel:` is omitted, the current channel is used. Idempotent: subscribing to a room you're already subscribed to is a no-op.

**`/cytube unsubscribe`** — three flavors:

- With both `room:` and `channel:` — removes that exact subscription.
- With only `room:` — removes that room's subscription in the current channel.
- With only `channel:` (or no args) — removes the single subscription in that channel; if the channel has multiple, the bot replies with a list and an "Unsubscribe all N" button to confirm.

**`/cytube list`** — shows every subscription in the current server.

## Install the server (for operators)

Ensure Node.js is configured to run in your environment: <https://nodejs.org/en>. You will also need [pnpm](https://pnpm.io/installation).

```sh
git clone git@github.com:the-darkwire/cytube-discord-bot.git
cd cytube-discord-bot
pnpm install
```

## Configure your environment

Create a `.env` file at the project root (see `.env.example`):

- `DISCORD_TOKEN` — bot auth token from the Discord Developer Portal (required)
- `DISCORD_CLIENT_ID` — Discord application ID; required for `pnpm deploy-commands` (one-time slash-command registration), not required at runtime

## Run the server

First-time setup: register the `/cytube` slash command globally with Discord:

```sh
pnpm deploy-commands
```

(Re-run any time the command definitions in `src/commands/cytube.ts` change.)

Then start the bot:

```sh
pnpm dev          # or `pnpm start` — both invoke `tsx index.ts`
```

Or run in Docker:

```sh
docker compose up --build
```

The bot's subscription store lives in a named Docker volume (`cytube-data`) and survives `docker compose up --build`. For container-free dev, the JSON store is at `./data/subscriptions.json` (gitignored).

For production deploys, see `.github/workflows/deploy.yml`.
