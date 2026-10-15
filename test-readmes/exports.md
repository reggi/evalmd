# Package `exports`

A package's own name resolves through its `exports`, with the conditions of the module system that imports it:

```js
import assert from 'assert';
import which from 'exports-pkg';

assert.equal(which, 'import');
```

```js
var assert = require('assert');

assert.equal(require('exports-pkg'), 'require');
assert.equal(require('exports-pkg/sub'), 'sub');
```
