# sloppy mode

This block uses `with`, which is a syntax error in strict mode, so it only
evaluates under `--sloppy`:

```js
var assert = require('assert')
var obj = { x: 41 }
with (obj) {
  assert.equal(x, 41)
}
```
