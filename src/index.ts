import {
    parse,
    serialize,
    defaultTreeAdapter,
    html,
} from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'

const { NS } = html

type Element = DefaultTreeAdapterTypes.Element
type ChildNode = DefaultTreeAdapterTypes.ChildNode
type ParentNode = DefaultTreeAdapterTypes.ParentNode

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X' +
    ' 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)' +
    ' Chrome/131.0.0.0 Safari/537.36'

/**
 * Get an attribute value from a parse5 element.
 */
function getAttr (el:Element, name:string):string|null {
    const attr = el.attrs.find(a => a.name === name)
    return attr ? attr.value : null
}

/**
 * Recursively walk the parse5 AST, collecting elements
 * that match the predicate.
 */
function findElements (
    node:ParentNode,
    predicate:(el:Element) => boolean
):Element[] {
    const results:Element[] = []
    const children = node.childNodes || []

    for (const child of children) {
        if (isElement(child)) {
            if (predicate(child)) {
                results.push(child)
            }
            results.push(...findElements(child, predicate))
        }
    }

    return results
}

function isElement (node:ChildNode):node is Element {
    return 'tagName' in node
}

/**
 * Resolve a URL against a base, handling data: URIs
 * and protocol-relative URLs.
 */
function resolveUrl (base:string, href:string):string {
    if (!href || href.startsWith('data:')) return href
    if (href.startsWith('//')) {
        const baseUrl = new URL(base)
        return `${baseUrl.protocol}${href}`
    }
    return new URL(href, base).href
}

/**
 * Resolve url() references inside CSS to absolute URLs.
 */
function resolveCssUrls (
    css:string,
    cssBaseUrl:string
):string {
    return css.replace(
        /url\(\s*['"]?(?!data:)([^'")\s]+)['"]?\s*\)/g,
        (_match, ref:string) => {
            try {
                const absolute = resolveUrl(cssBaseUrl, ref)
                return `url("${absolute}")`
            } catch {
                return _match
            }
        }
    )
}

/**
 * Fetch text content from a URL. Non-fatal on failure --
 * returns empty string and warns to stderr.
 */
async function fetchText (url:string):Promise<string> {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'follow',
        })

        if (!res.ok) {
            console.warn(
                `Warning: ${res.status} fetching ${url}`
            )
            return ''
        }

        return await res.text()
    } catch (err) {
        console.warn(
            `Warning: failed to fetch ${url}:`,
            (err as Error).message
        )
        return ''
    }
}

/**
 * Replace a node in its parent with a new node.
 */
function replaceNode (
    oldNode:ChildNode,
    newNode:ChildNode
):void {
    const parent = oldNode.parentNode
    if (!parent) return

    const idx = parent.childNodes.indexOf(oldNode)
    if (idx === -1) return

    defaultTreeAdapter.insertBefore(parent, newNode, oldNode)
    defaultTreeAdapter.detachNode(oldNode)
}

/**
 * Archive a web page by inlining all external CSS and JS
 * into a single self-contained HTML string.
 * Video sources are kept external.
 */
export async function archivePage (
    url:string
):Promise<string> {
    // 1. Fetch the page
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
    })

    if (!res.ok) {
        throw new Error(
            `Failed to fetch ${url}: ${res.status}`
        )
    }

    const html = await res.text()
    const baseUrl = res.url  // final URL after redirects

    // 2. Parse the HTML
    const doc = parse(html)

    // 3. Find external stylesheets
    const cssLinks = findElements(doc, el => {
        return el.tagName === 'link' &&
            getAttr(el, 'rel') === 'stylesheet' &&
            !!getAttr(el, 'href')
    })

    // 4. Find external scripts
    const extScripts = findElements(doc, el => {
        return el.tagName === 'script' &&
            !!getAttr(el, 'src')
    })

    // 5. Collect URLs and fetch in parallel
    const cssUrls = cssLinks.map(
        el => resolveUrl(baseUrl, getAttr(el, 'href')!)
    )
    const jsUrls = extScripts.map(
        el => resolveUrl(baseUrl, getAttr(el, 'src')!)
    )

    const [cssResults, jsResults] = await Promise.all([
        Promise.all(cssUrls.map(u => fetchText(u))),
        Promise.all(jsUrls.map(u => fetchText(u))),
    ])

    // 6. Inline CSS -- replace <link> with <style>
    for (let i = 0; i < cssLinks.length; i++) {
        const link = cssLinks[i]
        const cssText = resolveCssUrls(
            cssResults[i],
            cssUrls[i]
        )

        if (!cssText) {
            defaultTreeAdapter.detachNode(link)
            continue
        }

        const style = defaultTreeAdapter.createElement(
            'style',
            NS.HTML,
            []
        )
        defaultTreeAdapter.insertText(style, cssText)
        replaceNode(link, style)
    }

    // 7. Inline JS -- replace <script src> with inline
    for (let i = 0; i < extScripts.length; i++) {
        const script = extScripts[i]
        const jsText = jsResults[i]

        if (!jsText) {
            defaultTreeAdapter.detachNode(script)
            continue
        }

        // Copy attributes except src
        const attrs = script.attrs.filter(
            a => a.name !== 'src'
        )

        const newScript = defaultTreeAdapter.createElement(
            'script',
            NS.HTML,
            attrs
        )
        defaultTreeAdapter.insertText(newScript, jsText)
        replaceNode(script, newScript)
    }

    // 8. Serialize back to HTML
    return serialize(doc)
}
