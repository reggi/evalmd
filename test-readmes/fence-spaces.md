# fence info strings with surrounding whitespace

CommonMark trims the info string and takes its first word as the language, so
GFM renders all of the fences below as javascript; evalmd must evaluate them.

```js
var assert = require('assert');
var ranSpaced = false;
var ranPadded = false;
var ranExtraWords = false;
```

``` js
ranSpaced = true;
```

```   javascript  
ranPadded = true;
```

```js some extra words
ranExtraWords = true;
```

```js
assert.ok(ranSpaced, 'a "``` js" block (leading space) is evaluated');
assert.ok(ranPadded, 'a padded "javascript" block is evaluated');
assert.ok(ranExtraWords, 'a "js" block with trailing words is evaluated');
```
