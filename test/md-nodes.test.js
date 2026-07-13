'use strict';

const test = require('tape');
const md = require('../src/md-nodes');

test('getFences keeps only fence nodes whose info matches a language', (t) => {
  const nodes = [
    { type: 'fence', info: 'js' },
    { type: 'fence', info: 'sh' },
    { type: 'paragraph', info: '' },
    { type: 'fence', info: 'javascript extra' },
  ];
  const fenced = md.getFences(nodes, ['js', 'javascript']);
  t.equal(fenced.length, 2, 'keeps the js and javascript fences');
  t.deepEqual(fenced.map((n) => n.info), ['js', 'javascript extra'], 'ignores sh and non-fences');
  t.end();
});

test('replaceLines splices sub lines into main at the given start', (t) => {
  t.deepEqual(md.replaceLines(1, ['a', 'b', 'c'], ['X']), ['a', 'X', 'c'], 'replaces one line at index 1');
  t.deepEqual(md.replaceLines(0, 'a\nb', 'X\nY'), ['X', 'Y'], 'accepts strings and splits on newlines');
  t.end();
});

test('searchLink returns the captured group, true, or false', (t) => {
  const link = [{ content: '[label](#eval file)' }];
  t.equal(md.searchLink(link, /\[(.+)?\]\(#?(eval\s?file)\)/i), 'label', 'returns the first capture group');
  t.equal(md.searchLink([{ content: 'no link here' }], /\(eval\)/), false, 'returns false when nothing matches');
  t.end();
});

test('previousIndex finds the distance back to the previous matching node', (t) => {
  const nodes = [{ type: 'fence' }, { type: 'text' }, { type: 'text' }];
  const target = nodes[2];
  t.equal(md.previousIndex(target, nodes, (n) => n.type === 'fence'), 1, 'index just after the previous fence');
  t.equal(md.previousIndex(target, nodes, (n) => n.type === 'missing'), 0, 'returns 0 when no previous match');
  t.end();
});
