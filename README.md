# `evalmd`

[![Build Status](https://travis-ci.org/reggi/evalmd.svg?branch=master)](https://travis-ci.org/reggi/evalmd) [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

Write javascript in your markdown & execute it. I wanted a way of making sure the javscript that I write in markdown was valid and worked, not only for my own sake, but to ensure the examples and code provided was valid for others to reliably refer to.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Usage](#usage)
- [Testing](#testing)
- [Install](#install)
- [Current Module Definition](#current-module-definition)
- [Preventing Eval](#preventing-eval)
- [Prepend Flag](#prepend-flag)
- [Inspiration](#inspiration)
- [Todo](#todo)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Usage

`evalmd` will scan a markdown file searching for a javascript code declaration, all of them are gathered then the string sent to [`eval`](https://github.com/pierrec/node-eval).

    ```javascript
    ```

or

    ```js
    ```

## Testing

Here is a bit of javascript that has an assertion at the end of it. The assertion will throw an error if the result of the `.equal` is invalid. This file is used as a test to see if `evalmd` is in working order.

```javascript
var assert = require('assert')
var helloWorld = 'foo'
assert.equal(helloWorld, 'foo')
```

Here's another one:

```js
var assert = require('assert')
var helloWorld = ['foo', 'bar']
assert.deepEqual(helloWorld, ['foo', 'bar'])
```

If you run this file using `test-markdown` it will exit with a status code of `0`, meaning no exceptions where thrown.

This overall provides a different way of sharing and explaining code, because it's much more formal then a complicated test file.

## Install

Try it yourself by executing the command:

```bash
npm install evalmd -g
evalmd ./readme.md
```

## Current Module Definition

If the command is ran within a node module with a `package.main` and a `package.name` then that reference will be replaced throughout your code. For instance the following passes.

```javascript
var evalmd = require('evalmd')
assert.equal(typeof evalmd, 'function')
```

## Preventing Eval

If you don't want code to run you can add a comment to the first line of the code block `// prevent eval`, this will prevent the code from executing.

```javascript
// prevent eval
assert.equal(true, false)
```

You can also add `[](#prevent eval)` before the block so readers of the document won't see it.

    [](#prevent eval)
    ```javascript
    assert.equal(true, false)
    ```

## Prepend Flag

If you want to run code from `docs`, and your javscript files are in the root directory, you can use the `--prepend` flag to prepend every local module reference with the value.

Let's say you run the command:

```bash
evalmd ./docs/my-document.md --prepend='..'
```

And you have `my-document.md` with the conents:

    ```javascript
    var alpha = require('./alpha.js')
    ```

The prepend command will transform this code to this before it executes it.

    ```javascript
    var alpha = require('../alpha.js')
    ```

> Note: it's a prepend `path.join()` string, and not a concatenated prepend.

## Inspiration

I wanted a way of writing unit tests in markdown. I've been playing around with things like [`yamadapc/jsdoctest`](https://github.com/yamadapc/jsdoctest) which parses `JSDoc` declarations looking for `@example` keywords in source code and creates a test based on them.

## Todo

* Add ability for custom linting support (<3 [`standard`](https://github.com/feross/standard#standardlinttexttext-opts-callback))
