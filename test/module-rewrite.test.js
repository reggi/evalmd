'use strict';

const path = require('path');
const test = require('tape');
const mr = require('../src/module-rewrite');

test('replacePosition splices a value into a string range', (t) => {
  t.equal(mr.replacePosition('hello', 1, 3, 'XY'), 'hXYlo', 'replaces [start, end) with the value');
  t.equal(mr.replacePosition('abc', 0, 0, '!'), '!abc', 'an empty range inserts at the start');
  t.equal(mr.replacePosition('abc', 3, 3, '!'), 'abc!', 'an empty range at the end appends');
  t.end();
});

test('regExpEscape escapes regexp metacharacters', (t) => {
  t.equal(mr.regExpEscape('a.b'), 'a\\.b', 'escapes a dot');
  t.equal(mr.regExpEscape('a+b*c'), 'a\\+b\\*c', 'escapes + and *');
  t.equal(mr.regExpEscape('plain'), 'plain', 'leaves plain text untouched');
  t.end();
});

test('toRequirePath converts OS path separators to forward slashes', (t) => {
  t.equal(mr.toRequirePath(['a', 'b', 'c'].join(path.sep)), 'a/b/c', 'the platform separator becomes /');
  t.equal(mr.toRequirePath('already/forward'), 'already/forward', 'forward slashes are left alone');
  t.end();
});

test('getDeps finds a CommonJS require and brackets the quoted string', (t) => {
  const code = "require('foo');";
  const deps = mr.getDeps(code);
  t.equal(deps.length, 1, 'one dependency');
  t.equal(deps[0].source.value, 'foo', 'captures the module name');
  t.equal(code.slice(deps[0].source.start + 1, deps[0].source.end - 1), 'foo', 'start/end bracket the quoted string');
  t.end();
});

test('getDeps finds an ES module import in the default (module) mode', (t) => {
  const deps = mr.getDeps("import x from 'bar';");
  t.deepEqual(deps.map((dep) => dep.source.value), ['bar'], 'captures the imported module');
  t.end();
});

test('getDeps honors the sloppy option for script-only syntax', (t) => {
  const withBlock = "with (o) { require('baz'); }";
  t.deepEqual(mr.getDeps(withBlock, { sloppy: true }).map((dep) => dep.source.value), ['baz'], 'a `with` block parses in sloppy mode and its require is found');
  t.throws(() => mr.getDeps(withBlock), 'the default (module) mode rejects `with`');
  t.end();
});

test('getDeps uses a provided parse function instead of acorn', (t) => {
  const emptyProgram = {
    type: 'Program', body: [], start: 0, end: 0, sourceType: 'module',
  };
  const deps = mr.getDeps('!!! not valid js !!!', { parse: () => emptyProgram });
  t.deepEqual(deps, [], 'invalid code does not throw because acorn is bypassed');
  t.end();
});

test('alterNpmModules rewrites a bare npm specifier to a node_modules path', (t) => {
  const actual = mr.alterNpmModules("require('lodash')", [], '/proj');
  const expected = `require('${mr.toRequirePath(path.resolve(path.join('/proj', 'node_modules', 'lodash')))}')`;
  t.equal(actual, expected, 'the module name becomes an absolute node_modules path');
  t.end();
});
