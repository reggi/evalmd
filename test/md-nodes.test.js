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
  t.equal(md.previousIndex({}, nodes, () => true), 0, 'a node not in the list is clamped to index 0');
  t.end();
});

test('previousIndexClose and groupChildren split nodes at each _close node', (t) => {
  const nodes = [{ type: 'paragraph_close' }, { type: 'text' }, { type: 'text' }];
  t.equal(md.previousIndexClose(nodes[2], nodes), 1, 'distance back to the previous _close node');
  const groups = md.groupChildren(nodes);
  t.equal(groups.length, 2, 'splits into two groups at the close');
  t.deepEqual(groups[1], [nodes[1], nodes[2]], 'the second group holds the nodes after the close');
  t.end();
});

test('searchLink returns true when the pattern matches without a capture group', (t) => {
  t.equal(md.searchLink([{ content: 'see eval file' }], /eval file/), true, 'a groupless match yields true');
  t.equal(md.searchLink([{}], /eval file/), false, 'a node without content is skipped');
  t.end();
});

test('searchComment returns the second capture group, true, or false', (t) => {
  const pattern = /\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i;
  t.equal(md.searchComment({ content: '// file eval ./x.js' }, pattern), './x.js', 'returns the second capture group');
  t.equal(md.searchComment({ content: 'hello' }, /(hello)/), true, 'returns true when matched without a second group');
  t.equal(md.searchComment({ content: 'nope' }, pattern), false, 'returns false when nothing matches');
  t.end();
});

test('buildConcat joins contents and buildPreserveLines positions them by start line', (t) => {
  t.equal(md.buildConcat([{ content: 'a' }, { content: 'b' }]), 'ab', 'concatenates an array of nodes');
  t.equal(md.buildConcat({ content: 'solo' }), 'solo', 'accepts a single node');
  t.equal(md.buildPreserveLines({ content: 'X', startLine: 1 }, 3), '\nX\n', 'places content at its start line');
  t.end();
});

test('getFences and buildPreserveLines tolerate missing langs and content', (t) => {
  t.equal(md.getFences([{ type: 'fence' }, { type: 'text' }], null).length, 1, 'without a langs filter every fence is kept');
  t.equal(md.getFences([{ type: 'fence' }], ['js']).length, 0, 'a fence with no info string matches no language');
  t.equal(md.buildPreserveLines({ startLine: 0 }, 1), '', 'a node without content contributes nothing');
  t.end();
});
