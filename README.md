# cytube-discord-bot

A multi-tenant Discord bot that forwards CyTube media-change events into Discord text channels. Server admins bind a Discord channel to a CyTube channel via a slash command; the bot does the rest. One deployment handles any number of Discord servers.

## Server Owners

Want the bot in your Discord server?

**What it does once installed:**

- Posts a message in whichever Discord text channel you subscribe, every time the linked CyTube channel changes media (e.g. a new YouTube video starts).
- Supports any number of (CyTube channel → Discord channel) pairs across any number of Discord servers.

**Required Discord bot permissions:**

- View Channels
- Send Messages
- Use Application Commands

Invite scopes: `bot` + `applications.commands`. The bot is configured with only the `Guilds` gateway intent — no privileged intents like `Message Content` or `Server Members`.

**Setup checklist:**

1. Ask the bot operator to send you the bot's invite URL (or [create your own Discord application + bot](https://discord.com/developers/applications) if you're self-hosting).
2. Invite the bot to your server.
3. In whichever Discord text channel you want CyTube updates posted, run:

   ```
   /cytube subscribe channel:<your-cytube-channel-name>
   ```

   Replace `<your-cytube-channel-name>` with the name in the CyTube URL (e.g. for `https://cytu.be/r/myroom`, use `myroom`).
4. To list current subscriptions in your server: `/cytube list`
5. To stop forwarding in a channel: `/cytube unsubscribe` (run it in the channel you want to disconnect).

`/cytube subscribe` and `/cytube unsubscribe` require the **Manage Server** permission, so only admins can change subscriptions. `/cytube list` is available to everyone.

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
