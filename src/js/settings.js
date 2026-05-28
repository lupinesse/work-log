import { getProvider, defaultProviderId } from './providers/index.js'

const PROVIDER_KEY = 'provider'
const SYSTEM_MESSAGE_KEY = 'initial-system-message'
const MAX_MESSAGES_KEY = 'maximum-messages'

const DEFAULT_MAX_MESSAGES = 5

/**
 * Settings are persisted in `localStorage`. API keys and the selected model are
 * scoped per provider (so switching providers keeps each provider's own key and
 * last-used model), while the system prompt and history limit are shared.
 *
 * This module is the single source of truth for those keys; nothing else should
 * read or write `localStorage` directly.
 */

/**
 * Get the currently selected provider id.
 *
 * @returns {string} The provider id, or the default if none is stored.
 */
export const getProviderId = () => localStorage.getItem(PROVIDER_KEY) || defaultProviderId

/**
 * Persist the selected provider id.
 *
 * @param {string} providerId - The provider id to store.
 * @returns {void}
 */
export const setProviderId = providerId => localStorage.setItem(PROVIDER_KEY, providerId)

/**
 * Get the API key for a provider.
 *
 * @param {string} providerId - The provider id.
 * @returns {string} The stored key, or an empty string.
 */
export const getApiKey = providerId => localStorage.getItem(`api-key-${providerId}`) || ''

/**
 * Persist the API key for a provider.
 *
 * @param {string} providerId - The provider id.
 * @param {string} key - The API key to store.
 * @returns {void}
 */
export const setApiKey = (providerId, key) => localStorage.setItem(`api-key-${providerId}`, key)

/**
 * Get the selected model for a provider, defaulting to its first model.
 *
 * @param {string} providerId - The provider id.
 * @returns {string} The model id.
 */
export const getModel = providerId =>
    localStorage.getItem(`model-${providerId}`) || getProvider(providerId).models[0].value

/**
 * Persist the selected model for a provider.
 *
 * @param {string} providerId - The provider id.
 * @param {string} model - The model id to store.
 * @returns {void}
 */
export const setModel = (providerId, model) => localStorage.setItem(`model-${providerId}`, model)

/**
 * Get the shared system prompt.
 *
 * @returns {string} The system prompt, or an empty string.
 */
export const getSystemMessage = () => localStorage.getItem(SYSTEM_MESSAGE_KEY) || ''

/**
 * Get the maximum number of previous messages to send with each request.
 *
 * @returns {number} The configured limit, or the default when unset/invalid.
 */
export const getMaxMessages = () => {
    const value = parseInt(localStorage.getItem(MAX_MESSAGES_KEY), 10)
    return Number.isNaN(value) ? DEFAULT_MAX_MESSAGES : value
}
