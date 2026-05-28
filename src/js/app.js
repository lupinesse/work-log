import { getProvider, listProviders } from './providers/index.js'
import {
    getProviderId,
    setProviderId,
    getApiKey,
    setApiKey,
    getModel,
    setModel,
    getSystemMessage,
    getMaxMessages
} from './settings.js'
import {
    parseHashParams,
    isScrolledToBottom,
    updateTextareaSize,
    setupPersistentInputs
} from './utils.js'
import { markdownToDocumentFragment } from './markdown.js'
import html2canvas from 'html2canvas'

/* -------------------------------------------------------------------------- */
/* Provider / settings UI wiring                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read the model id currently chosen in the toolbar model dropdown.
 *
 * @returns {string} The selected model id.
 */
const getSelectedModel = () => {
    const select = document.querySelector('#model-select')
    return select.options[select.selectedIndex].value
}

/**
 * Populate a `<select>` with a provider's models, selecting the stored model.
 *
 * @param {HTMLSelectElement} select - The model dropdown to fill.
 * @param {import('./providers/index.js').Provider} provider - The provider.
 * @returns {void}
 */
const populateModelSelect = (select, provider) => {
    const stored = getModel(provider.id)
    select.innerHTML = ''
    for (const model of provider.models) {
        const option = document.createElement('option')
        option.value = model.value
        option.textContent = model.label
        option.selected = model.value === stored
        select.appendChild(option)
    }
}

/**
 * Reflect the active provider across the whole UI: provider dropdowns, model
 * list, API key inputs, help links, and the key-status message.
 *
 * @returns {void}
 */
const applyActiveProvider = () => {
    const providerId = getProviderId()
    const provider = getProvider(providerId)

    for (const select of document.querySelectorAll('.provider-select')) {
        select.value = providerId
    }

    populateModelSelect(document.querySelector('#model-select'), provider)

    const apiKey = getApiKey(providerId)
    for (const input of document.querySelectorAll('.api-key-input')) {
        input.value = apiKey
        input.placeholder = provider.apiKeyPlaceholder
    }

    for (const link of document.querySelectorAll('.api-key-help-link')) {
        link.href = provider.apiKeyHelpUrl
        link.textContent = provider.apiKeyHelpLabel
    }
    for (const link of document.querySelectorAll('.usage-link')) {
        link.href = provider.usageUrl
    }

    updateApiKeyStatus()
}

/**
 * Clear all API key status messages.
 *
 * @returns {void}
 */
const clearApiKeyStatus = () => {
    for (const element of document.querySelectorAll('.api-key-status')) {
        element.classList.remove('error', 'success')
        element.textContent = ''
    }
}

/**
 * Verify the active provider's stored key and reflect the result in the UI.
 *
 * @returns {void}
 */
const updateApiKeyStatus = () => {
    const provider = getProvider(getProviderId())
    const apiKey = getApiKey(provider.id)
    const statusElements = document.querySelectorAll('.api-key-status')
    const continueButton = document.querySelector('#intro-continue')

    clearApiKeyStatus()
    continueButton.classList.add('secondary')

    if (!apiKey) {
        return
    }

    for (const element of statusElements) {
        element.textContent = 'Checking…'
    }

    provider.verifyKey(apiKey).then(result => {
        for (const element of statusElements) {
            if (result.ok) {
                element.textContent = 'This API key is working!'
                element.classList.add('success')
            } else {
                element.textContent = result.message
                element.classList.add('error')
            }
        }
        if (result.ok) {
            continueButton.classList.remove('secondary')
        }
    })
}

/**
 * Attach handlers to the provider dropdowns, API key inputs and model dropdown.
 *
 * @returns {void}
 */
const setupProviderControls = () => {
    for (const select of document.querySelectorAll('.provider-select')) {
        select.addEventListener('change', () => {
            setProviderId(select.value)
            applyActiveProvider()
        })
    }

    for (const input of document.querySelectorAll('.api-key-input')) {
        input.addEventListener('input', () => {
            const providerId = getProviderId()
            setApiKey(providerId, input.value)
            for (const other of document.querySelectorAll('.api-key-input')) {
                if (other !== input) {
                    other.value = input.value
                }
            }
            updateApiKeyStatus()
        })
    }

    document.querySelector('#model-select').addEventListener('change', () => {
        setModel(getProviderId(), getSelectedModel())
    })

    // Keep the UI in sync when settings change in another tab.
    window.addEventListener('storage', () => applyActiveProvider())
}

/**
 * Fill both provider dropdowns with the registered providers.
 *
 * @returns {void}
 */
const populateProviderSelects = () => {
    for (const select of document.querySelectorAll('.provider-select')) {
        select.innerHTML = ''
        for (const provider of listProviders()) {
            const option = document.createElement('option')
            option.value = provider.id
            option.textContent = provider.label
            select.appendChild(option)
        }
    }
}

/**
 * Show or hide the intro overlay depending on whether the active provider has a
 * key. Wires the intro and settings open/close buttons.
 *
 * @returns {void}
 */
const setupOverlays = () => {
    const introView = document.querySelector('#intro-view')
    const settingsView = document.querySelector('#settings-view')

    if (!getApiKey(getProviderId())) {
        introView.classList.remove('hidden')
    }

    document.querySelector('#intro-continue').addEventListener('click', () => {
        introView.classList.add('hidden')
        document.querySelector('#prompt').focus()
    })

    document.querySelector('#settings-button').addEventListener('click', () => {
        settingsView.classList.remove('hidden')
        clearApiKeyStatus()
        for (const textarea of document.querySelectorAll('textarea')) {
            updateTextareaSize(textarea)
        }
    })

    document.querySelector('#settings-exit-button').addEventListener('click', () => {
        settingsView.classList.add('hidden')
    })

    document.querySelector('#settings-show-intro').addEventListener('click', () => {
        settingsView.classList.add('hidden')
        introView.classList.remove('hidden')
        updateApiKeyStatus()
    })
}

/* -------------------------------------------------------------------------- */
/* Conversation export                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Trigger a browser download of the given data URL.
 *
 * @param {string} dataUrl - The data URL to download.
 * @param {string} filename - The suggested filename.
 * @returns {void}
 */
const downloadDataUrl = (dataUrl, filename) => {
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
}

/**
 * Save the conversation as a PNG screenshot of the output area.
 *
 * @returns {void}
 */
const saveScreenshot = () => {
    const element = document.querySelector('#output')
    const backgroundColor = getComputedStyle(document.body).backgroundColor
    html2canvas(element, { backgroundColor }).then(canvas => {
        downloadDataUrl(canvas.toDataURL('image/png'), 'assistant.png')
    })
}

/**
 * Save the conversation as a markdown file.
 *
 * @param {Array<{role: string, content: string}>} messages - The conversation,
 *   including the leading system message.
 * @returns {void}
 */
const saveMarkdown = messages => {
    const capitalise = text => text.charAt(0).toUpperCase() + text.slice(1)
    const content = messages.map(message => `## ${capitalise(message.role)}\n${message.content}`).join('\n\n')
    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content)
    downloadDataUrl(dataUrl, 'assistant.md')
}

/* -------------------------------------------------------------------------- */
/* Message rendering                                                          */
/* -------------------------------------------------------------------------- */

let mouseDown = false
let hasSelectedText = false

document.addEventListener('mousedown', () => {
    mouseDown = true
    hasSelectedText = false
})

document.addEventListener('mousemove', () => {
    if (mouseDown && window.getSelection().toString().length > 0) {
        hasSelectedText = true
    }
})

document.addEventListener('mouseup', () => {
    mouseDown = false
})

let notificationTimeout = null

/**
 * Show a transient notification toast.
 *
 * @param {string} text - The message to display.
 * @returns {void}
 */
const showNotification = text => {
    const notification = document.querySelector('#notification')
    notification.className = 'notification show'
    notification.textContent = text
    if (notificationTimeout) {
        clearTimeout(notificationTimeout)
    }
    notificationTimeout = setTimeout(() => {
        notification.className = 'notification'
    }, 4000)
}

/**
 * Add click-to-copy behaviour to code elements in a fragment.
 *
 * @param {DocumentFragment} fragment - The rendered markdown fragment.
 * @returns {void}
 */
const injectCopyEventListeners = fragment => {
    for (const code of fragment.querySelectorAll('code, pre')) {
        code.addEventListener('click', event => {
            if (hasSelectedText) {
                return
            }
            event.stopPropagation()
            navigator.clipboard
                .writeText(code.innerText)
                .then(() => showNotification('Copied!'))
                .catch(() => showNotification('Could not copy to clipboard.'))
        })
    }
}

/**
 * Append a rendered message bubble to the output area.
 *
 * @param {string} message - The markdown content.
 * @param {string} type - The bubble type (`my-message` or `response`).
 * @returns {HTMLElement} The created message container.
 */
const addMessage = (message, type) => {
    const output = document.querySelector('#output')

    const container = document.createElement('div')
    container.classList.add(`${type}-container`)
    output.appendChild(container)

    const bubble = document.createElement('div')
    bubble.classList.add(`${type}-bubble`, 'message-bubble')
    const fragment = markdownToDocumentFragment(message)
    injectCopyEventListeners(fragment)
    bubble.appendChild(fragment)
    container.appendChild(bubble)

    return container
}

const addSentMessage = message => addMessage(message, 'my-message')
const addReceivedMessage = message => addMessage(message, 'response')

/**
 * Append a plain-text error message to the output area.
 *
 * @param {string} message - The error text.
 * @returns {HTMLElement} The created error container.
 */
const addErrorMessage = message => {
    const output = document.querySelector('#output')
    const container = document.createElement('div')
    container.classList.add('response-container', 'error')
    container.textContent = message
    output.appendChild(container)
    return container
}

/**
 * Remove any error messages currently shown.
 *
 * @returns {void}
 */
const removeErrorMessages = () => {
    for (const error of document.querySelectorAll('.error')) {
        error.remove()
    }
}

/* -------------------------------------------------------------------------- */
/* Conversation orchestration                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Truncate the conversation to the configured history limit while preserving a
 * valid leading `user` turn (required by the Anthropic API and harmless for
 * OpenAI).
 *
 * @param {Array<{role: string, content: string}>} conversation - Turns
 *   excluding the system message.
 * @param {number} maxMessages - Maximum number of turns to keep.
 * @returns {Array<{role: string, content: string}>} The truncated turns.
 */
const truncateConversation = (conversation, maxMessages) => {
    const truncated = conversation.slice(-maxMessages)
    while (truncated.length > 0 && truncated[0].role !== 'user') {
        truncated.shift()
    }
    return truncated
}

/**
 * Initialise the application once the DOM is ready.
 *
 * @returns {void}
 */
const init = () => {
    setupPersistentInputs()
    populateProviderSelects()
    setupProviderControls()
    setupOverlays()
    applyActiveProvider()

    // The conversation always begins with the (possibly empty) system message.
    const messages = [{ role: 'system', content: getSystemMessage() }]

    document.querySelector('#screenshot-button').addEventListener('click', saveScreenshot)
    document.querySelector('#save-md-button').addEventListener('click', () => saveMarkdown(messages))

    /**
     * Send a user message and stream the assistant's reply.
     *
     * @param {string} message - The user's message text.
     * @returns {void}
     */
    const sendMessage = message => {
        const providerId = getProviderId()
        const provider = getProvider(providerId)
        const apiKey = getApiKey(providerId)

        if (!apiKey) {
            addErrorMessage('Add an API key in settings before sending a message.')
            return
        }

        removeErrorMessages()
        addSentMessage(message)
        const typingIndicator = addReceivedMessage('● ● ●')
        document.body.scrollIntoView({ block: 'end', behavior: 'smooth' })

        messages.push({ role: 'user', content: message })

        // Always keep the system message; cap the rest at the history limit.
        // +1 so the just-added user turn is never itself truncated away.
        const maxMessages = getMaxMessages() + 1
        const systemMessage = messages[0].content
        const conversation = truncateConversation(messages.slice(1), maxMessages)

        let assistantMessage = null
        let bubble = null

        /** Lazily create the assistant message/bubble on first content. */
        const ensureStarted = () => {
            if (assistantMessage) {
                return
            }
            if (typingIndicator.parentNode) {
                typingIndicator.remove()
            }
            assistantMessage = { role: 'assistant', content: '' }
            messages.push(assistantMessage)
            bubble = addReceivedMessage('')
        }

        provider.streamChat(
            apiKey,
            { model: getSelectedModel(), systemMessage, messages: conversation },
            {
                onStart: () => ensureStarted(),
                onDelta: text => {
                    ensureStarted()
                    const wasAtBottom = isScrolledToBottom()
                    assistantMessage.content += text
                    bubble.firstChild.innerHTML = ''
                    const fragment = markdownToDocumentFragment(assistantMessage.content + '\n')
                    injectCopyEventListeners(fragment)
                    bubble.firstChild.appendChild(fragment)
                    if (wasAtBottom) {
                        window.scrollTo(0, document.body.scrollHeight)
                    }
                },
                onError: errorText => {
                    if (typingIndicator.parentNode) {
                        typingIndicator.remove()
                    }
                    addErrorMessage(errorText)
                }
            }
        )
    }

    const textbox = document.querySelector('#prompt')

    /** Read, clear and submit the compose box. */
    const submitMessageForm = () => {
        const input = textbox.value.trim()
        textbox.value = ''
        updateTextareaSize(textbox)
        if (input) {
            sendMessage(input)
        }
    }

    textbox.addEventListener('keydown', event => {
        // Use the deprecated keyCode here: it is the only reliable way to avoid
        // submitting mid-composition with IME keyboards (e.g. Chinese pinyin).
        if (event.keyCode === 13 && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            event.preventDefault()
            submitMessageForm()
        }
    })

    document.querySelector('#compose-box').addEventListener('submit', event => {
        event.preventDefault()
        submitMessageForm()
    })

    for (const textarea of document.querySelectorAll('textarea')) {
        textarea.addEventListener('input', () => updateTextareaSize(textarea))
        updateTextareaSize(textarea)
    }

    // Ctrl+M cycles through the current provider's models.
    document.addEventListener('keydown', event => {
        if (event.ctrlKey && event.key.toLowerCase() === 'm') {
            const select = document.querySelector('#model-select')
            select.selectedIndex = (select.selectedIndex + 1) % select.options.length
            setModel(getProviderId(), getSelectedModel())
        }
    })

    // Deep link: `#q=...` sends an initial prompt on load.
    const hashParams = parseHashParams()
    if (hashParams.q) {
        sendMessage(hashParams.q)
    }
}

window.addEventListener('load', init)
