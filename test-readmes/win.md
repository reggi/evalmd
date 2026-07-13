# windows module path rewriting

These `require`s get rewritten to absolute paths; on Windows the paths must use forward slashes, or the generated code is corrupted (issue #11).

```js
var assert = require('assert')
var pkg = require('evalmd/package.json')
assert.equal(pkg.name, 'evalmd')
var implementation = require('object.assign/implementation')
assert.equal(typeof implementation, 'function')
```
