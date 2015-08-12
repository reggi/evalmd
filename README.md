# `evalmd`

[![Build Status](https://travis-ci.org/reggi/evalmd.svg?branch=master)](https://travis-ci.org/reggi/evalmd) [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

I wanted a way of writing unit tests in markdown. I've been playing around with things like [`yamadapc/jsdoctest`](https://github.com/yamadapc/jsdoctest) which parses `JSDoc` declarations looking for `@example` keywords in source code and creates a test based on them. I took this one step further and just wanted to be able two ensure that the javascript I write within markdown is valid.

```javascript
var assert = require('assert')
var helloWorld = 'foo'
assert.equal(helloWorld, 'foo')
```

and

```js
var assert = require('assert')
var helloWorld = ['foo', 'bar']
assert.deepEqual(helloWorld, ['foo', 'bar'])
```

If you run this file using `test-markdown` it will exit with a status code of `0`, meaning no exceptions where thrown.

This overall provides a different way of sharing and explaining code, because it's much more formal then a complicated test file.

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

If you don't want code to run you can add a comment to the firs line of the code block `// prevent eval`, this will prevent the code from executing.

```javascript
// prevent eval
assert.equal(true, false)
```

## Todo:

* Add ability for custom linting support (<3 [`standard`](https://github.com/feross/standard#standardlinttexttext-opts-callback))

<!-- START doctoc -->
<!-- END doctoc -->
