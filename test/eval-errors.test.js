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

test('acornError passes non-acorn errors through untouched', (t) => {
  t.equal(errors.acornError([], '/x.md')('not an error'), 'not an error', 'a value without a loc is returned as-is');
  t.end();
});

test('getCleanLines rewrites a stack line that references a block temp file', (t) => {
  const nodes = [{
    fileEvalHashPath: '/tmp/hash.js', startLine: 1, endLine: 5, id: 3, fileEval: false,
  }];
  const cleaned = errors.getCleanLines(['    at Object.<anonymous> (/tmp/hash.js:2:9)'], nodes, '/abs/readme.md', false);
  t.equal(cleaned.length, 1, 'keeps the matched line');
  t.match(cleaned[0], /\/abs\/readme\.md:2:9/, 'rewrites the temp path to the markdown location');
  t.match(cleaned[0], /\{block 3\}/, 'annotates the block id');
  t.end();
});

test('getCleanLines handles line-only frames and a fileEval annotation', (t) => {
  const nodes = [{
    fileEvalHashPath: '/tmp/h.js', startLine: 1, endLine: 9, id: 4, fileEval: './mod.js',
  }];
  const cleaned = errors.getCleanLines(['/tmp/h.js:7'], nodes, '/abs/r.md', true);
  t.match(cleaned[0], /\/abs\/r\.md:7\b/, 'rewrites a line-only location without a column');
  t.match(cleaned[0], /\{block 4 \(\.\/mod\.js\)\}/, 'annotates the block id and fileEval');
  t.end();
});

test('getCleanLines matches against a concat node fileEvalHashPath', (t) => {
  const nodes = [];
  nodes.fileEvalHashPath = '/tmp/concat.js';
  nodes.fileEval = false;
  nodes.id = 2;
  const cleaned = errors.getCleanLines(['    at (/tmp/concat.js:3:1)'], nodes, '/abs/c.md', false);
  t.match(cleaned[0], /\/abs\/c\.md:3:1 \{block 2\}/, 'uses the concat node id');
  t.end();
});

test('acornError omits a block annotation when no node contains the line', (t) => {
  const err = new Error('bad');
  err.loc = { line: 99, column: 1 };
  err.stack = 'Error: bad\n    at x (/t.js:99:1)';
  t.equal((/\{block/).test(errors.acornError([], '/n.md')(err)), false, 'no block is annotated when none matches');
  t.end();
});

test('parseLineChar reads a location out of an Error message', (t) => {
  t.deepEqual(errors.parseLineChar(new Error('at /x:4:2')), { lineChar: ':4:2', line: 4, char: 2 }, 'uses the message of an Error');
  t.end();
});
