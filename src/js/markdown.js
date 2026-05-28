import DOMPurify from 'dompurify'
import { parse } from 'marked'

/**
 * Render a markdown string into a sanitised DocumentFragment ready to append to
 * the DOM.
 *
 * `&`, `<`, and `>` are escaped before parsing so that raw HTML in model output
 * is shown literally rather than interpreted. `marked` re-escapes those
 * characters inside code spans/blocks, leaving them double-escaped, so one
 * layer is unwrapped from `<code>` elements afterwards. The result is still run
 * through DOMPurify, so this is a display concern, not a security boundary.
 *
 * @param {string} md - The markdown source.
 * @returns {DocumentFragment} The rendered, sanitised fragment.
 */
export const markdownToDocumentFragment = md => {
    md = md.replaceAll('&', '&amp;')
    md = md.replaceAll('<', '&lt;')
    md = md.replaceAll('>', '&gt;')

    const html = DOMPurify.sanitize(
        parse(md, {
            gfm: true,
            breaks: true
        })
    )
    const fragment = htmlToDocumentFragment(html)

    for (const code of fragment.querySelectorAll('code')) {
        code.innerHTML = code.innerHTML.replaceAll('&amp;', '&')
    }

    return fragment
}

/**
 * Parse an HTML string into a DocumentFragment using a detached template.
 *
 * @param {string} html - The HTML to parse.
 * @returns {DocumentFragment} The parsed fragment.
 */
const htmlToDocumentFragment = html => {
    const template = document.createElement('template')
    template.innerHTML = html
    return template.content
}
