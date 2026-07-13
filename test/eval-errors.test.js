'use strict';

const test = require('tape');
const errors = require('../src/eval-errors');

test('parseLineChar extracts line and column from a location string', (t) => {
  t.deepEqual(errors.parseLineChar('foo:12:5'), { lineChar: ':12:5', line: 12, char: 5 }, 'parses line and column');
  t.deepEqual(errors.parseLineChar('foo:7'), { lineChar: 7, line: 7, char: false }, 'parses a line-only location');
  t.equal(errors.parseLineChar('no location'), false, 'returns false when no location is present');
  t.end();
});

test('stackSplit separates frame lines from `at` stack lines', (t) => {
  const split = errors.stackSplit('Error: boom\n    at foo (x:1:1)\n    at bar (y:2:2)');
  t.deepEqual(split.frame, ['Error: boom'], 'frame holds the non-at lines');
  t.equal(split.lines.length, 2, 'lines holds the two `    at ` lines');
  t.end();
});

test('findErrorNode finds the node whose line range contains the line', (t) => {
  const nodes = [
    { startLine: 1, endLine: 3, id: 1 },
    { startLine: 5, endLine: 9, id: 2 },
  ];
  t.equal(errors.findErrorNode(nodes, 6).id, 2, 'matches the containing node');
  t.equal(errors.findErrorNode(nodes, 4), undefined, 'returns undefined when no node contains the line');
  t.end();
});

test('acornError rewrites an acorn error stack to point at the source block', (t) => {
  const err = new Error('bad');
  err.loc = { line: 2, column: 4 };
  err.stack = 'Error: bad\n    at Object.<anonymous> (/tmp/x.js:2:4)';
  const nodes = [{ startLine: 1, endLine: 3, id: 7 }];
  const rewritten = errors.acornError(nodes, '/path/to.md')(err);
  t.match(rewritten, /\{block 7\}/, 'annotates the offending block id');
  t.match(rewritten, /to\.md:2:4/, 'points at the markdown file and location');
  t.end();
});
