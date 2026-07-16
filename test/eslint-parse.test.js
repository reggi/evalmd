'use strict';

const path = require('path');
const fs = require('fs');
const osTmpDir = require('os-tmpdir');
const mkdirp = require('mkdirp');
const test = require('tape');
const resolveParse = require('../src/eslint-parse');

// installed eslint is resolvable but throws a SyntaxError on node older than its engines
const canLoadEslint = (() => {
  try {
    // eslint-disable-next-line global-require
    require(require.resolve('eslint'));
    return true;
  } catch (e) {
    return false;
  }
})();

test('detectFormat finds the flat config at the repo root', (t) => {
  t.equal(resolveParse.detectFormat(process.cwd()), 'flat', 'this repo uses a flat eslint.config.mjs');
  t.end();
});

test('detectFormat returns false when no config exists up to the filesystem root', (t) => {
  t.equal(resolveParse.detectFormat(path.parse(process.cwd()).root), false, 'no config is found at the root');
  t.end();
});

test('normalizeNodePositions backfills start/end from range and skips parent links', (t) => {
  const parent = { type: 'Program', range: [0, 9] };
  const child = { type: 'Ident', range: [1, 4], parent };
  parent.body = [child];
  const ast = resolveParse.normalizeNodePositions(parent);
  t.equal(ast.start, 0, 'the program start is backfilled');
  t.equal(ast.end, 9, 'the program end is backfilled');
  t.equal(child.start, 1, 'a nested node start is backfilled');
  t.equal(child.end, 4, 'a nested node end is backfilled');
  t.end();
});

test('detectFormat recognizes eslintrc files and package.json eslintConfig', (t) => {
  t.equal(resolveParse.detectFormat(path.resolve('test/fixtures/eslintrc')), 'eslintrc', 'an .eslintrc file is eslintrc format');
  t.equal(resolveParse.detectFormat(path.resolve('test/fixtures/pkgconfig')), 'eslintrc', 'a package.json eslintConfig is eslintrc format');
  t.end();
});

test('resolveParse builds a working parser from an eslintrc config', { skip: !canLoadEslint }, (t) => {
  resolveParse('marker.md', '1', path.resolve('test/fixtures/eslintrc')).then((parse) => {
    t.equal(typeof parse, 'function', 'a parse function is produced from the legacy config');
    const ast = parse('var x = 1;');
    t.equal(ast.type, 'Program', 'the parser returns an AST');
    t.equal(ast.start, 0, 'positions are normalized');
    t.end();
  }, (err) => {
    t.fail(err && err.message);
    t.end();
  });
});

test('normalizeNodePositions leaves a node without a range untouched', (t) => {
  const ast = resolveParse.normalizeNodePositions({ type: 'Program', body: [{ type: 'X' }] });
  t.equal(ast.start, undefined, 'a node with neither start nor range gets no start');
  t.equal(ast.body[0].start, undefined, 'a nested node without a range is left alone');
  t.end();
});

test('resolveParse explains itself when eslint resolves but can not be loaded', (t) => {
  const cwd = path.join(osTmpDir(), 'evalmd-unloadable-eslint');
  const eslintDir = path.join(cwd, 'node_modules', 'eslint');
  mkdirp.sync(eslintDir);
  fs.writeFileSync(path.join(eslintDir, 'package.json'), '{ "name": "eslint", "version": "10.0.0", "main": "index.js" }');
  fs.writeFileSync(path.join(eslintDir, 'index.js'), 'module.exports = {');
  t.throws(
    () => resolveParse('marker.md', '1', cwd),
    (/could not load it/),
    'an unloadable eslint yields an actionable error rather than a raw SyntaxError'
  );
  fs.unlinkSync(path.join(eslintDir, 'index.js'));
  fs.unlinkSync(path.join(eslintDir, 'package.json'));
  fs.rmdirSync(eslintDir);
  fs.rmdirSync(path.join(cwd, 'node_modules'));
  fs.rmdirSync(cwd);
  t.end();
});

test('normalizeNodePositions leaves existing start/end and ignores non-nodes', (t) => {
  const ast = {
    type: 'Program',
    start: 2,
    end: 3,
    range: [0, 9],
    leaf: 'text',
    empty: null,
    plain: { notANode: true },
  };
  const result = resolveParse.normalizeNodePositions(ast);
  t.equal(result.start, 2, 'an existing start is left alone');
  t.equal(result.end, 3, 'an existing end is left alone');
  t.end();
});
