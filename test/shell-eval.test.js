'use strict';

const test = require('tape');
const evalmd = require('../src/eval-markdown');

test('parsePromptBlock pairs a prompt command with its output', (t) => {
  const actual = evalmd.parsePromptBlock('> echo hi\nhi');
  t.deepEqual(actual, [{ command: 'echo hi', expected: 'hi' }], 'captures the command and its output line');
  t.end();
});

test('parsePromptBlock handles multiple prompts and the $ / % characters', (t) => {
  const actual = evalmd.parsePromptBlock('$ one\n1\n% two\n2');
  const expected = [
    { command: 'one', expected: '1' },
    { command: 'two', expected: '2' },
  ];
  t.deepEqual(actual, expected, 'treats $ and % as prompts and groups each command with its output');
  t.end();
});

test('parsePromptBlock returns nothing when there are no prompt lines', (t) => {
  t.deepEqual(evalmd.parsePromptBlock('just text\nmore text'), [], 'content without prompts yields no commands');
  t.end();
});
