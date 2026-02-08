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
        html.includes('<html'),
        'should contain an html element'
    )
    t.ok(
        html.includes('<head'),
        'should contain a head element'
    )
    t.ok(
        html.includes('<body'),
        'should contain a body element'
    )
})

test('contains no scripts', async t => {
    const hasScript = /<script/i
    t.ok(
        !hasScript.test(html),
        'should not contain any script tags'
    )
})

test('contains inlined styles', async t => {
    t.ok(
        html.includes('<style'),
        'should contain inlined style elements'
    )
})

test('contains top-level comments', async t => {
    t.ok(
        html.includes('yta-comment'),
        'should contain rendered comment elements'
    )
    t.ok(
        html.includes('yta-thread'),
        'should contain thread wrappers'
    )
})

test('contains threaded replies', async t => {
    t.ok(
        html.includes('yta-replies-details'),
        'should contain reply details elements'
    )
    t.ok(
        html.includes('yta-replies-toggle'),
        'should contain reply toggle buttons'
    )
    t.ok(
        /\d+ replies/.test(html),
        'should contain "N replies" text'
    )
    t.ok(
        html.includes('yta-replies-list'),
        'should contain reply list containers'
    )
})

test('page is a reasonable size', async t => {
    const sizeMB = html.length / (1024 * 1024)
    t.ok(
        sizeMB < 50,
        `should be under 50MB (got ${sizeMB.toFixed(2)}MB)`
    )
})
