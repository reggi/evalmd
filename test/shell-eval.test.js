'use strict';

const test = require('tape');
const shell = require('../src/shell-eval');

test('parsePromptBlock pairs a prompt command with its output', (t) => {
  const actual = shell.parsePromptBlock('> echo hi\nhi');
  t.deepEqual(actual, [{ command: 'echo hi', expected: 'hi' }], 'captures the command and its output line');
  t.end();
});

test('parsePromptBlock handles multiple prompts and the $ / % characters', (t) => {
  const actual = shell.parsePromptBlock('$ one\n1\n% two\n2');
  const expected = [
    { command: 'one', expected: '1' },
    { command: 'two', expected: '2' },
  ];
  t.deepEqual(actual, expected, 'treats $ and % as prompts and groups each command with its output');
  t.end();
});

test('parsePromptBlock returns nothing when there are no prompt lines', (t) => {
  t.deepEqual(shell.parsePromptBlock('just text\nmore text'), [], 'content without prompts yields no commands');
  t.end();
});

test('normalizeKinds dedupes and maps javascript to js', (t) => {
  t.deepEqual(shell.normalizeKinds(['js', 'javascript', 'sh', 'js']), ['js', 'sh'], 'javascript collapses into js, dupes dropped');
  t.end();
});

test('checkPromptCommand passes on matching output, normalizing CRLF', (t) => {
  const ok = shell.checkPromptCommand({ command: 'x', expected: 'a\nb' }, { code: 0, output: 'a\r\nb\n' });
  t.equal(ok, false, 'CRLF and trailing newline are normalized before comparing');
  t.end();
});

test('checkPromptCommand returns an Error on a non-zero exit code', (t) => {
  const err = shell.checkPromptCommand({ command: 'boom', expected: '' }, { code: 1, output: 'oops' });
  t.ok(err instanceof Error, 'returns an Error');
  t.match(err.message, /exited with code 1/, 'reports the exit code');
  t.end();
});

test('checkPromptCommand returns an Error on mismatched output', (t) => {
  const err = shell.checkPromptCommand({ command: 'x', expected: 'a' }, { code: 0, output: 'b' });
  t.ok(err instanceof Error, 'returns an Error');
  t.match(err.message, /did not match/, 'reports a mismatch');
  t.end();
});
