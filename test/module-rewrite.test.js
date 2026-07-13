'use strict';

const test = require('tape');
const evalmd = require('../src/eval-markdown');

test('replacePosition splices a value into a string range', (t) => {
  t.equal(evalmd.replacePosition('hello', 1, 3, 'XY'), 'hXYlo', 'replaces [start, end) with the value');
  t.equal(evalmd.replacePosition('abc', 0, 0, '!'), '!abc', 'an empty range inserts at the start');
  t.equal(evalmd.replacePosition('abc', 3, 3, '!'), 'abc!', 'an empty range at the end appends');
  t.end();
});

test('regExpEscape escapes regexp metacharacters', (t) => {
  t.equal(evalmd.regExpEscape('a.b'), 'a\\.b', 'escapes a dot');
  t.equal(evalmd.regExpEscape('a+b*c'), 'a\\+b\\*c', 'escapes + and *');
  t.equal(evalmd.regExpEscape('plain'), 'plain', 'leaves plain text untouched');
  t.end();
});
