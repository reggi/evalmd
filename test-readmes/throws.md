# Expected throws

A statement whose line ends with a `// throws` comment must throw:

```js
var assert = require('assert');

JSON.parse('{'); // throws
JSON.parse('{}'); // returns an object
assert.ok(true);
```
