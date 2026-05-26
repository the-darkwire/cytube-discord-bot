# cytube-discord-bot

This is a server hosting a Discord bot for notifying text channels about CyTube media change events.

Upon launching your server, your bot should immediately send a message to the specified Discord channel notifying the channel of any currently playing media. For as long as the bot is playing, it will notify the channel of any new media beginning.

## Install the server

Ensure NodeJS is configured to run in your environment: https://nodejs.org/en

Clone the repository:

```
git clone git@github.com:the-darkwire/cytube-discord-bot.git
```

Change into the repository directory:

```
cd cytube-discord-bot
```

Install dependencies:

```
npm install
```

## Configure your environment

This project uses [dotenv](https://github.com/bkeepers/dotenv) to read sensitive information from the process environment at runtime.

As of writing, you will need to provide 3 pieces of information for this bot to work:

- The name of the CyTube channel you wish to connect to
- The auth token of the Discord bot account you setup to perform this task
- The ID of the text channel you would like the bot to notify when media changes

An example is provided in `.env.example`. You will need to create your own `.env` at the project root which contains the same keys, but with the values swapped out to fit your application.

## Run the server

```
npm run start
```
