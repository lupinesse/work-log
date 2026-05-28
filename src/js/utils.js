/**
 * Parse the URL hash into a key/value map.
 *
 * Accepts an explicit hash string (mainly for testing); defaults to the current
 * window location hash. Enables deep links such as `#q=hello` that pre-fill and
 * send an initial prompt.
 *
 * @param {string} [hash=window.location.hash] - The hash to parse, with or
 *   without a leading `#`.
 * @returns {Record<string, string>} The decoded parameters.
 */
export const parseHashParams = (hash = window.location.hash) => {
    const params = {}
    const raw = hash.startsWith('#') ? hash.slice(1) : hash
    if (!raw) {
        return params
    }
    for (const pair of raw.split('&')) {
        const [key, value] = pair.split('=')
        if (key) {
            params[decodeURIComponent(key)] = decodeURIComponent(value ?? '')
        }
    }
    return params
}

/**
 * Determine whether the document is scrolled to the bottom.
 *
 * Used to decide whether to keep the view pinned to the latest output while a
 * response streams in.
 *
 * @returns {boolean} True if the viewport is at the bottom of the page.
 */
export const isScrolledToBottom = () => {
    const { scrollTop, clientHeight, scrollHeight } = document.documentElement
    return scrollTop + clientHeight >= scrollHeight
}

/**
 * Resize a textarea to fit its content (auto-growing input box).
 *
 * @param {HTMLTextAreaElement} element - The textarea to resize.
 * @returns {void}
 */
export const updateTextareaSize = element => {
    element.style.height = 0
    const style = window.getComputedStyle(element)
    const paddingTop = parseFloat(style.getPropertyValue('padding-top'))
    const paddingBottom = parseFloat(style.getPropertyValue('padding-bottom'))
    const height = element.scrollHeight - paddingTop - paddingBottom
    element.style.height = `${height}px`
}

/**
 * Wire up inputs marked with `data-persistent-name` so their values are saved
 * to `localStorage` and kept in sync across inputs that share a name and across
 * browser tabs.
 *
 * @returns {void}
 */
export const setupPersistentInputs = () => {
    const persistentInputs = document.querySelectorAll('[data-persistent-name]')
    const getName = element => element.getAttribute('data-persistent-name')

    for (const input of persistentInputs) {
        const name = getName(input)
        if (localStorage.getItem(name) === null) {
            localStorage.setItem(name, input.value)
        }
    }

    for (const input of persistentInputs) {
        const name = getName(input)
        input.value = localStorage.getItem(name)

        input.addEventListener('input', () => {
            const value = input.value
            localStorage.setItem(name, value)
            for (const other of persistentInputs) {
                if (getName(other) === name) {
                    other.value = value
                }
            }
        })

        window.addEventListener('storage', event => {
            if (event.key === name) {
                input.value = event.newValue
            }
        })
    }
}
