import { test } from '@substrate-system/tapzero'
import { archivePage } from '../src/index.js'

const TEST_URL = 'https://youtu.be/q86g1aop6a8'

let html:string

test('archivePage returns HTML', async t => {
    html = await archivePage(TEST_URL)
    t.ok(typeof html === 'string', 'should return a string')
    t.ok(html.length > 0, 'should not be empty')
})

test('result has document structure', async t => {
    t.ok(
        html.includes('<html') || html.includes('<HTML'),
        'should contain an html element'
    )
    t.ok(
        html.includes('<head') || html.includes('<HEAD'),
        'should contain a head element'
    )
    t.ok(
        html.includes('<body') || html.includes('<BODY'),
        'should contain a body element'
    )
})

test('no external stylesheet links remain', async t => {
    const hasExternalCss =
        /<link[^>]+rel=["']stylesheet["'][^>]+href/i
    t.ok(
        !hasExternalCss.test(html),
        'should not have external CSS links'
    )
})

test('no external script src remain', async t => {
    const hasExternalScript = /<script[^>]+src=/i
    t.ok(
        !hasExternalScript.test(html),
        'should not have external script src attributes'
    )
})

test('contains inlined style tags', async t => {
    t.ok(
        html.includes('<style'),
        'should contain inlined style elements'
    )
})

test('contains inline script content', async t => {
    // YouTube pages always have inline scripts with
    // page data like ytInitialData
    t.ok(
        html.includes('ytInitialData') ||
            html.includes('ytInitialPlayerResponse') ||
            html.includes('ytcfg'),
        'should contain YouTube page data in scripts'
    )
})

test('no video data inlined', async t => {
    // A YouTube page with inlined CSS/JS is ~15-20MB due
    // to the large JS bundles. Video data would be 100s of
    // MB, so 50MB is a safe upper bound.
    const sizeMB = html.length / (1024 * 1024)
    t.ok(
        sizeMB < 50,
        `should be under 50MB (got ${sizeMB.toFixed(2)}MB)`
    )
})
