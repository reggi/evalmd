'use strict';

const test = require('tape');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const semver = require('semver');

/** @param {string} dir */
function findRoot(dir) {
  let current = dir;
  while (!fs.existsSync(path.join(current, 'package.json'))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('could not locate the package root');
    }
    current = parent;
  }
  return current;
}

const root = findRoot(__dirname);
// the native lane runs against the source with no build, so fall back to the .ts entry point node runs directly
const compiled = path.join(root, 'dist', 'script.js');
const cli = fs.existsSync(compiled) ? compiled : path.join(root, 'src', 'script.ts');

const canLoadEslint = semver.satisfies(process.version, require(require.resolve('eslint/package.json')).engines.node);

/** @param {string[]} args */
function run(args) {
  return spawnSync(process.execPath, [cli].concat(args), { cwd: root, encoding: 'utf8' });
}

const USAGE = /Evaluate the javascript in markdown files/;

test('a positional markdown file is evaluated', (t) => {
  const { status, stderr } = run(['./test-readmes/qs.md']);
  t.equal(status, 0, 'exits zero');
  t.match(stderr, /info ok/, 'evaluates the file and reports ok');
  t.end();
});

test('a boolean flag before the file is not swallowed (--sloppy)', (t) => {
  const { status, stdout, stderr } = run(['--sloppy', './test-readmes/sloppy.md']);
  t.equal(status, 0, 'exits zero instead of printing help');
  t.doesNotMatch(stdout, USAGE, 'does not fall through to the help output');
  t.match(stderr, /info ok/, 'the file is still a positional and is evaluated');
  t.end();
});

test('--eslint before the file is not swallowed', { skip: !canLoadEslint }, (t) => {
  const { status, stdout, stderr } = run(['--eslint', './test-readmes/win.md']);
  t.equal(status, 0, 'exits zero instead of printing help');
  t.doesNotMatch(stdout, USAGE, 'does not fall through to the help output');
  t.match(stderr, /info ok/, 'the file is evaluated with the eslint-derived parser');
  t.end();
});

test('flags after the file still work', (t) => {
  const { status } = run(['./test-readmes/sh.md', '--eval=js,sh']);
  t.equal(status, 0, 'exits zero');
  t.end();
});

test('no files prints the help', (t) => {
  const { stdout } = run([]);
  t.match(stdout, USAGE, 'prints usage when given no files');
  t.end();
});

test('--version prints the package version', (t) => {
  const { stdout } = run(['--version']);
  t.match(stdout, /\d+\.\d+\.\d+/, 'prints a semver version');
  t.end();
});
