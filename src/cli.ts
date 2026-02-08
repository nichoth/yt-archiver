#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { archivePage } from './index.js'

const { values, positionals } = parseArgs({
    options: {
        output: {
            type: 'string' as const,
            short: 'o',
        },
        help: {
            type: 'boolean' as const,
            short: 'h',
        },
    },
    allowPositionals: true,
})

if (values.help || positionals.length === 0) {
    console.log(
        'Usage: yt-archiver <url> [-o output.html]'
    )
    process.exit(positionals.length === 0 ? 1 : 0)
}

const url = positionals[0]

try {
    const html = await archivePage(url)

    if (values.output) {
        await writeFile(values.output, html, 'utf-8')
        console.error(`Wrote ${values.output}`)
    } else {
        process.stdout.write(html)
    }
} catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
}
