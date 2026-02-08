const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X' +
    ' 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)' +
    ' Chrome/131.0.0.0 Safari/537.36'

const REPLY_BATCH_SIZE = 5

interface Comment {
    author:string
    avatarUrl:string
    text:string
    time:string
    likes:string
}

interface CommentThread {
    comment:Comment
    replyCount:string
    replies:Comment[]
}

// -- Helpers --

function escapeHtml (str:string):string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// -- YouTube data extraction --

function extractJsonVar (
    rawHtml:string,
    varName:string
):any {
    const re = new RegExp(
        'var ' + varName +
            '\\s*=\\s*(\\{.+?\\});\\s*</script>',
        's'
    )
    const match = rawHtml.match(re)
    if (!match) return null
    try {
        return JSON.parse(match[1])
    } catch {
        return null
    }
}

function extractApiKey (rawHtml:string):string|null {
    const m = rawHtml.match(
        /"INNERTUBE_API_KEY":"([^"]+)"/
    )
    return m?.[1] ?? null
}

function extractClientVersion (
    rawHtml:string
):string|null {
    const m = rawHtml.match(
        /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/
    )
    return m?.[1] ?? null
}

function extractTitle (rawHtml:string):string {
    const m = rawHtml.match(
        /property="og:title"\s+content="([^"]+)"/
    )
    return m?.[1] ?? ''
}

// -- Comment fetching --

function findCommentsContinuation (
    data:any
):string|null {
    const contents = data
        ?.contents
        ?.twoColumnWatchNextResults
        ?.results?.results?.contents

    if (!Array.isArray(contents)) return null

    for (const item of contents) {
        const isr = item.itemSectionRenderer
        if (
            isr?.sectionIdentifier !==
            'comment-item-section'
        ) {
            continue
        }
        for (const c of (isr.contents || [])) {
            const token = c
                ?.continuationItemRenderer
                ?.continuationEndpoint
                ?.continuationCommand?.token
            if (token) return token
        }
    }

    return null
}

/**
 * Parse a comment entity payload mutation into a
 * Comment object.
 */
function mutationToComment (payload:any):Comment {
    return {
        author:
            payload.author?.displayName || '',
        avatarUrl:
            payload.author?.avatarThumbnailUrl || '',
        text:
            payload.properties?.content
                ?.content || '',
        time:
            payload.properties
                ?.publishedTime || '',
        likes:
            payload.toolbar
                ?.likeCountNotliked || '',
    }
}

interface ThreadInfo {
    commentKey:string
    replyCount:string
    replyContinuation:string|null
}

/**
 * Parse a page of top-level comments. Returns thread
 * structure from continuationItems, comment data from
 * mutations, and the next page continuation.
 */
function parseTopLevelPage (data:any):{
    threads:ThreadInfo[]
    commentMap:Map<string, Comment>
    nextContinuation:string|null
} {
    const threads:ThreadInfo[] = []
    let nextContinuation:string|null = null

    const endpoints =
        data?.onResponseReceivedEndpoints || []
    for (const ep of endpoints) {
        const action =
            ep.reloadContinuationItemsCommand
            || ep.appendContinuationItemsAction
        if (!action?.continuationItems) continue

        for (const item of action.continuationItems) {
            const ctr = item.commentThreadRenderer
            if (ctr) {
                const commentKey = ctr.commentViewModel
                    ?.commentViewModel?.commentKey
                if (!commentKey) continue

                // Extract reply continuation token
                let replyCont:string|null = null
                const rc = ctr.replies
                    ?.commentRepliesRenderer
                    ?.contents || []
                for (const c of rc) {
                    const t = c
                        ?.continuationItemRenderer
                        ?.continuationEndpoint
                        ?.continuationCommand?.token
                    if (t) { replyCont = t; break }
                }

                threads.push({
                    commentKey,
                    replyCount: '',
                    replyContinuation: replyCont,
                })
                continue
            }

            // Next page continuation
            const contToken = item
                ?.continuationItemRenderer
                ?.continuationEndpoint
                ?.continuationCommand?.token
            if (contToken) {
                nextContinuation = contToken
            }
        }
    }

    // Parse comment data from mutations
    const commentMap = new Map<string, Comment>()
    const mutations = data
        ?.frameworkUpdates
        ?.entityBatchUpdate?.mutations || []

    for (const m of mutations) {
        const payload = m.payload?.commentEntityPayload
        if (!payload) continue
        commentMap.set(payload.key, mutationToComment(payload))

        // Backfill replyCount onto the matching thread
        const replyCount =
            payload.toolbar?.replyCount || ''
        if (replyCount) {
            const thread = threads.find(
                t => t.commentKey === payload.key
            )
            if (thread) thread.replyCount = replyCount
        }
    }

    return { threads, commentMap, nextContinuation }
}

/**
 * POST to YouTube's InnerTube next endpoint.
 */
async function postNext (
    apiUrl:string,
    clientVersion:string,
    continuation:string
):Promise<any> {
    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
            context: {
                client: {
                    clientName: 'WEB',
                    clientVersion,
                    hl: 'en',
                    gl: 'US',
                },
            },
            continuation,
        }),
    })

    if (!res.ok) {
        throw new Error(
            `API returned ${res.status}`
        )
    }

    return res.json()
}

/**
 * Fetch all replies for a single comment thread.
 */
async function fetchReplies (
    apiUrl:string,
    clientVersion:string,
    initialContinuation:string
):Promise<Comment[]> {
    const replies:Comment[] = []
    let continuation:string|null = initialContinuation

    while (continuation) {
        const data = await postNext(
            apiUrl, clientVersion, continuation
        )

        const mutations = data
            ?.frameworkUpdates
            ?.entityBatchUpdate?.mutations || []

        let added = 0
        for (const m of mutations) {
            const p = m.payload?.commentEntityPayload
            if (!p) continue
            replies.push(mutationToComment(p))
            added++
        }

        if (added === 0) break

        // Find next page of replies
        continuation = null
        const endpoints =
            data?.onResponseReceivedEndpoints || []
        for (const ep of endpoints) {
            const action =
                ep.reloadContinuationItemsCommand
                || ep.appendContinuationItemsAction
            if (!action?.continuationItems) continue
            const items = action.continuationItems
            for (let i = items.length - 1; i >= 0; i--) {
                const t = items[i]
                    ?.continuationItemRenderer
                    ?.continuationEndpoint
                    ?.continuationCommand?.token
                if (t) { continuation = t; break }
            }
        }
    }

    return replies
}

/**
 * Fetch all comment threads including replies.
 */
async function fetchAllThreads (
    apiKey:string,
    clientVersion:string,
    initialContinuation:string
):Promise<CommentThread[]> {
    const apiUrl = 'https://www.youtube.com' +
        `/youtubei/v1/next?key=${apiKey}`

    // -- Phase 1: Fetch all top-level comments --
    const allThreads:Array<{
        comment:Comment
        replyCount:string
        replyContinuation:string|null
    }> = []

    let continuation:string|null = initialContinuation

    while (continuation) {
        try {
            const data = await postNext(
                apiUrl, clientVersion, continuation
            )
            const {
                threads,
                commentMap,
                nextContinuation,
            } = parseTopLevelPage(data)

            for (const t of threads) {
                const comment = commentMap.get(
                    t.commentKey
                )
                if (!comment) continue
                allThreads.push({
                    comment,
                    replyCount: t.replyCount,
                    replyContinuation:
                        t.replyContinuation,
                })
            }

            console.warn(
                `Fetched ${threads.length} comments` +
                ` (${allThreads.length} total)`
            )

            if (threads.length === 0) break
            continuation = nextContinuation
        } catch (err) {
            console.warn(
                'Warning: failed to fetch comments:',
                (err as Error).message
            )
            break
        }
    }

    // -- Phase 2: Fetch replies in batches --
    const withReplies = allThreads.filter(
        t => t.replyContinuation
    )
    console.warn(
        `\nFetching replies for ${
            withReplies.length
        } threads...`
    )

    const result:CommentThread[] = allThreads.map(t => ({
        comment: t.comment,
        replyCount: t.replyCount,
        replies: [],
    }))

    // Map from thread index in allThreads -> result
    const replyJobs = withReplies.map(t => ({
        idx: allThreads.indexOf(t),
        continuation: t.replyContinuation!,
    }))

    let fetchedThreads = 0
    for (
        let i = 0;
        i < replyJobs.length;
        i += REPLY_BATCH_SIZE
    ) {
        const batch = replyJobs.slice(
            i, i + REPLY_BATCH_SIZE
        )
        const batchResults = await Promise.all(
            batch.map(async (job) => {
                try {
                    return await fetchReplies(
                        apiUrl,
                        clientVersion,
                        job.continuation
                    )
                } catch (err) {
                    console.warn(
                        'Warning: failed to ' +
                        'fetch replies:',
                        (err as Error).message
                    )
                    return []
                }
            })
        )

        for (let j = 0; j < batch.length; j++) {
            result[batch[j].idx].replies =
                batchResults[j]
        }

        fetchedThreads += batch.length
        console.warn(
            'Fetched replies for ' +
            fetchedThreads + '/' +
            withReplies.length +
            ' threads'
        )
    }

    return result
}

// -- Page building --

function renderComment (c:Comment):string {
    const likesHtml = c.likes ?
        `<span class="yta-likes">${
            escapeHtml(c.likes)
        }</span>` :
        ''

    return `<div class="yta-comment">
  <img class="yta-avatar"
    src="${escapeHtml(c.avatarUrl)}"
    alt="${escapeHtml(c.author)}" loading="lazy" />
  <div class="yta-comment-body">
    <span class="yta-author">${
        escapeHtml(c.author)
    }</span>
    <span class="yta-time">${
        escapeHtml(c.time)
    }</span>
    <p class="yta-text">${escapeHtml(c.text)}</p>
    ${likesHtml}
  </div>
</div>`
}

function renderThread (thread:CommentThread):string {
    const commentHtml = renderComment(thread.comment)

    if (thread.replies.length === 0) {
        return `<div class="yta-thread">${
            commentHtml
        }</div>`
    }

    const n = thread.replies.length
    const label = n === 1 ?
        '1 reply' :
        `${n} replies`

    const repliesHtml = thread.replies
        .map(renderComment)
        .join('\n')

    return `<div class="yta-thread">
${commentHtml}
<details class="yta-replies-details">
  <summary class="yta-replies-toggle">${
      label
  }</summary>
  <div class="yta-replies-list">
${repliesHtml}
  </div>
</details>
</div>`
}

function buildPage (
    title:string,
    threads:CommentThread[]
):string {
    const totalComments = threads.reduce(
        (sum, t) => sum + 1 + t.replies.length, 0
    )

    const threadsHtml = threads
        .map(renderThread)
        .join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport"
    content="width=device-width, initial-scale=1" />
  <title>Comments -- ${escapeHtml(title)}</title>
  <style>
*, *::before, *::after { box-sizing: border-box; }
body {
    margin: 0;
    padding: 0;
    font-family: Roboto, Arial, sans-serif;
    color: #0f0f0f;
    background: #fff;
}
.yta-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 16px;
}
.yta-page-title {
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    margin: 0 0 4px;
}
.yta-comments-header {
    font-size: 14px;
    color: #606060;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e5e5e5;
}
.yta-thread {
    margin-bottom: 8px;
}
.yta-comment {
    display: flex;
    gap: 12px;
    padding: 8px 0;
}
.yta-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
}
.yta-replies-list .yta-avatar {
    width: 24px;
    height: 24px;
}
.yta-comment-body {
    flex: 1;
    min-width: 0;
}
.yta-author {
    font-size: 13px;
    font-weight: 500;
}
.yta-time {
    font-size: 12px;
    color: #606060;
    margin-left: 4px;
}
.yta-text {
    font-size: 14px;
    line-height: 1.4;
    margin: 4px 0 4px;
    white-space: pre-wrap;
    word-break: break-word;
}
.yta-likes {
    font-size: 12px;
    color: #606060;
}
.yta-replies-details {
    margin-left: 52px;
}
.yta-replies-toggle {
    font-size: 14px;
    font-weight: 500;
    color: #065fd4;
    cursor: pointer;
    padding: 8px 0;
    list-style: none;
    user-select: none;
}
.yta-replies-toggle::-webkit-details-marker {
    display: none;
}
.yta-replies-toggle::before {
    content: "\\25B6";
    display: inline-block;
    margin-right: 6px;
    font-size: 10px;
    transition: transform 0.15s;
}
details[open] > .yta-replies-toggle::before {
    transform: rotate(90deg);
}
.yta-replies-list {
    padding-top: 4px;
}
  </style>
</head>
<body>
  <div class="yta-page">
    <h1 class="yta-page-title">${
        escapeHtml(title)
    }</h1>
    <div class="yta-comments-header">${
        totalComments
    } comments</div>
${threadsHtml}
  </div>
</body>
</html>`
}

/**
 * Fetch all threaded comments for a YouTube video
 * and return a self-contained static HTML page.
 */
export async function archivePage (
    url:string
):Promise<string> {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
    })

    if (!res.ok) {
        throw new Error(
            `Failed to fetch ${url}: ${res.status}`
        )
    }

    const rawHtml = await res.text()

    const ytInitialData = extractJsonVar(
        rawHtml, 'ytInitialData'
    )
    const apiKey = extractApiKey(rawHtml)
    const clientVersion = extractClientVersion(rawHtml)
    const title = extractTitle(rawHtml)

    const commentsContinuation = ytInitialData ?
        findCommentsContinuation(ytInitialData) :
        null

    let threads:CommentThread[] = []
    if (apiKey && clientVersion && commentsContinuation) {
        threads = await fetchAllThreads(
            apiKey, clientVersion, commentsContinuation
        )
    }

    return buildPage(title, threads)
}
