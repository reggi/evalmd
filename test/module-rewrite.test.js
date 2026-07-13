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
