# `sh` + `js` block tests

A javascript block, evaluated when `js` is enabled:

```js
var assert = require('assert')
assert.equal(1 + 1, 2)
```

A shell block with a single prompt:

```sh
> echo hello world
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
> echo first
first
> echo second
second
```

Other prompt characters (`$` and `%`) work too:

```sh
$ printf 'a\nb\n'
a
b
```

```sh
% echo percent
percent
```
