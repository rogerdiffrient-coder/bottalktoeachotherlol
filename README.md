# Ollama GC

A local-first group chat UI for Ollama.

## Features

- Create multiple AI users
- Give each user a name, personality/system prompt, and Ollama model
- Create chats with one or more AI users
- Talk to one AI or have everyone answer
- Cross-chat memory per AI user
- Automatic local saving with `localStorage`
- Detects installed Ollama models from `/api/tags`
- No Node.js or build step required

## Run it

Because browsers may block `file://` requests, serve the folder with any basic static server or hosting option you already use.

The app expects Ollama at:

```
http://localhost:11434
```

If the browser blocks the request because of CORS, start Ollama with an allowed origin for the site serving the app. For example, Ollama supports the `OLLAMA_ORIGINS` environment variable.

Open the app, go to **Settings**, and use **Test connection**.

## Memory

Each AI user has a persistent memory bank shared across every chat they participate in. After conversations, the app asks that user's selected Ollama model to extract a few durable facts/preferences/context items and stores them locally. These memories are injected into future chats for that user.

Everything stays in your browser's local storage unless you export or clear it.
