# Assistant

A private, **no-backend** browser chat UI for the **OpenAI** and **Anthropic**
APIs. Bring your own API key — it is stored only in your browser and sent
directly to the provider you choose. Switch between ChatGPT and Claude models at
any time.

This is an independent, maintained reimplementation inspired by the (now
unmaintained) [`felixbade/assistant`](https://github.com/felixbade/assistant),
extended with switchable OpenAI + Anthropic providers.

## Features

- **Two providers, switchable** — OpenAI (GPT-4o / GPT-4.1) and Anthropic
  (Claude Opus / Sonnet / Haiku). Each keeps its own API key and last-used model.
- **No backend** — requests go straight from your browser to the provider. Your
  key lives in `localStorage` and is synced across tabs.
- **Streaming replies** with live markdown rendering (code blocks, tables,
  links, images).
- **Prompt caching** on the Anthropic system prompt to cut repeat-token cost.
- **PWA** — installable to a phone home screen or as a desktop app, with offline
  shell caching via a service worker.
- **Export** the conversation as markdown or as a PNG screenshot.
- **Configurable history limit** and a shared **system prompt**.
- **Automatic dark / light theme** following the OS setting.
- **Deep link** — open with `#q=your%20prompt` to send an initial message.
- **Ctrl+M** cycles through the current provider's models.

## Getting started

Requires Node.js ≥ 20 (see `.nvmrc`).

```bash
npm install
npm run dev      # webpack dev server at http://localhost:8080
```

Open the app, pick a provider, and paste an API key:

- **OpenAI** — <https://platform.openai.com/account/api-keys>
- **Anthropic** — <https://console.anthropic.com/settings/keys>

> Anthropic blocks browser-origin API calls by default; this app opts in with
> the `anthropic-dangerous-direct-browser-access` header. That is appropriate
> here because it is *your* key, sent from *your* browser, only to Anthropic. Do
> not reuse this pattern in an app that ships a shared key to end users.

## Build & deploy

```bash
npm run build    # outputs a static bundle to dist/
```

`dist/` is a fully static site — host it anywhere (GitHub Pages, Netlify, nginx,
an S3 bucket). There is nothing to run server-side.

## Testing

Unit tests cover the pure provider request/response logic, the SSE reader, and
the hash parser. They run on Node's built-in test runner (no extra deps):

```bash
npm test
```

## Project layout

```
src/
  index.html          app shell
  index.js            entry point (styles + app + service worker)
  style/main.css      styles (light/dark)
  js/
    app.js            UI wiring and conversation orchestration
    settings.js       localStorage-backed settings (per-provider keys/models)
    markdown.js       markdown → sanitised DOM
    sse.js            shared Server-Sent Events reader
    utils.js          small DOM/util helpers
    providers/
      index.js        provider registry + shared types
      stream.js       shared streaming transport
      openai.js       OpenAI provider
      anthropic.js    Anthropic (Claude) provider
test/                 unit tests (node --test)
```

Adding a provider means implementing the `Provider` interface in
`src/js/providers/` and registering it in `providers/index.js`; the UI adapts
automatically.

## License

MIT
