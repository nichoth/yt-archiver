# Youtube Archiver
![tests](https://github.com/nichoth/yt-archiver/actions/workflows/nodejs.yml/badge.svg)
[![types](https://img.shields.io/npm/types/@nichoth/yt-archiver?style=flat-square)](README.md)
[![module](https://img.shields.io/badge/module-ESM%2FCJS-blue?style=flat-square)](README.md)
[![semantic versioning](https://img.shields.io/badge/semver-2.0.0-blue?logo=semver&style=flat-square)](https://semver.org/)
[![Common Changelog](https://nichoth.github.io/badge/common-changelog.svg)](./CHANGELOG.md)
[![install size](https://flat.badgen.net/packagephobia/install/@nichoth/yt-archiver)](https://packagephobia.com/result?p=@nichoth/yt-archiver)
[![license](https://img.shields.io/badge/license-Big_Time-blue?style=flat-square)](LICENSE)


Archive the comments on youtube pages.

[See a live demo](https://namespace.github.io/package-name/)

<details><summary><h2>Contents</h2></summary>

<!-- toc -->

- [Install](#install)
- [API](#api)
  * [ESM](#esm)
  * [Common JS](#common-js)
- [Example](#example)
  * [JS](#js)

<!-- tocstop -->

</details>

## Install

```sh
npm i -S @nichoth/yt-archiver
```

## API

This exposes ESM and common JS via [package.json `exports` field](https://nodejs.org/api/packages.html#exports).

### ESM
```js
import '@nichoth/yt-archiver'
```

### Common JS
```js
require('@nichoth/yt-archiver')
```

## Example

This is a command line tool.

```sh
npx yta https://www.youtube.com/watch?v=q86g1aop6a8 -o example.html
```

### JS
```js
import { archivePage } from '@nichoth/yt-archiver'

const html = await archivePage(
    'https://www.youtube.com/watch?v=q86g1aop6a8'
)
// => self-contained HTML string with all threaded
//    comments, ready to write to a file
```
