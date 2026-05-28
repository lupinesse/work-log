import { openai } from './openai.js'
import { anthropic } from './anthropic.js'

/**
 * @typedef {object} ProviderModel
 * @property {string} value - The model id sent to the API.
 * @property {string} label - Human-readable name shown in the dropdown.
 */

/**
 * @typedef {object} Provider
 * @property {string} id - Stable identifier used as a storage key suffix.
 * @property {string} label - Human-readable provider name.
 * @property {string} apiKeyPlaceholder - Placeholder for the API key input.
 * @property {string} apiKeyHelpUrl - Link to where the user gets a key.
 * @property {string} apiKeyHelpLabel - Link text for the help URL.
 * @property {string} usageUrl - Link to the provider's usage dashboard.
 * @property {ProviderModel[]} models - Selectable models for this provider.
 * @property {(apiKey: string) => Promise<{ok: boolean, message?: string}>} verifyKey -
 *   Validate an API key.
 * @property {(apiKey: string, options: object, handlers: import('./stream.js').StreamHandlers) => Promise<void>} streamChat -
 *   Stream a chat/message completion.
 */

/** @type {Record<string, Provider>} */
export const providers = {
    [openai.id]: openai,
    [anthropic.id]: anthropic
}

/** The provider selected by default on first run. */
export const defaultProviderId = openai.id

/**
 * Look up a provider by id, falling back to the default if unknown.
 *
 * @param {string} id - The provider id.
 * @returns {Provider} The matching provider, or the default provider.
 */
export const getProvider = id => providers[id] || providers[defaultProviderId]

/**
 * List all registered providers in display order.
 *
 * @returns {Provider[]} The providers.
 */
export const listProviders = () => Object.values(providers)
