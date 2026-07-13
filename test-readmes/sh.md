# `sh` + `js` block tests

A javascript block, evaluated when `js` is enabled:

```js
var assert = require('assert')
assert.equal(1 + 1, 2)
```

A shell block with a single prompt:

```sh
> node -e "console.log('hello world')"
hello world
```

Combined stdout and stderr, in emitted order:

```sh
> node -e "console.log('one'); console.error('two')"
one
two
```

Multiple prompts in one block:

```sh
> node -e "console.log('first')"
first
> node -e "console.log('second')"
second
```

Other prompt characters (`$` and `%`), and multi-line output:

```sh
$ node -e "console.log('a\nb')"
a
b
```

```sh
% node -e "console.log('percent')"
percent
```
