# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-28

### Added
- Initial release: a no-backend browser chat UI for the OpenAI and Anthropic
  APIs, inspired by the unmaintained `felixbade/assistant`.
- Switchable providers (OpenAI and Anthropic/Claude), each with its own stored
  API key and last-used model.
- Streaming replies with live markdown rendering and click-to-copy code blocks.
- Prompt caching on the Anthropic system prompt.
- PWA support (installable, offline shell caching via service worker).
- Export the conversation as markdown or PNG.
- Shared system prompt and configurable conversation-history limit.
- Automatic dark/light theme and `#q=` deep-link initial prompt.
- Unit tests for provider request/response logic, the SSE reader, and hash
  parsing, runnable with `node --test`.
