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

test('getDeps finds a CommonJS require and brackets the quoted string', (t) => {
  const code = "require('foo');";
  const deps = mr.getDeps(code);
  t.equal(deps.length, 1, 'one dependency');
  t.equal(deps[0].source.value, 'foo', 'captures the module name');
  t.equal(code.slice(deps[0].source.start + 1, deps[0].source.end - 1), 'foo', 'start/end bracket the quoted string');
  t.end();
});

test('getDeps finds an ES module import in the default (module) mode', (t) => {
  const deps = mr.getDeps("import x from 'bar';");
  t.deepEqual(deps.map((dep) => dep.source.value), ['bar'], 'captures the imported module');
  t.end();
});

test('getDeps honors the sloppy option for script-only syntax', (t) => {
  const withBlock = "with (o) { require('baz'); }";
  t.deepEqual(mr.getDeps(withBlock, { sloppy: true }).map((dep) => dep.source.value), ['baz'], 'a `with` block parses in sloppy mode and its require is found');
  t.throws(() => mr.getDeps(withBlock), 'the default (module) mode rejects `with`');
  t.end();
});

test('getDeps uses a provided parse function instead of acorn', (t) => {
  const emptyProgram = {
    type: 'Program', body: [], start: 0, end: 0, sourceType: 'module',
  };
  const deps = mr.getDeps('!!! not valid js !!!', { parse: () => emptyProgram });
  t.deepEqual(deps, [], 'invalid code does not throw because acorn is bypassed');
  t.end();
});

test('alterNpmModules rewrites a bare npm specifier to a node_modules path', (t) => {
  const actual = mr.alterNpmModules("require('lodash')", [], '/proj');
  const expected = `require('${mr.toRequirePath(path.resolve(path.join('/proj', 'node_modules', 'lodash')))}')`;
  t.equal(actual, expected, 'the module name becomes an absolute node_modules path');
  t.end();
});

test('alterAssignedModule rewrites the package self-reference to a filesystem path', (t) => {
  const pkg = { name: 'mypkg', path: '/proj/package.json' };
  const abs = path.dirname(path.resolve(pkg.path));
  t.equal(mr.alterAssignedModule("require('mypkg/sub')", '', pkg), `require('${mr.toRequirePath(path.join(abs, '/sub'))}')`, 'the self-name becomes an absolute path');
  t.equal(mr.alterAssignedModule("require('x')", '', false), "require('x')", 'no package leaves the code untouched');
  t.equal(mr.alterAssignedModule('var x = 1;', '', pkg), 'var x = 1;', 'code with no deps is untouched');
  t.end();
});

test('alterSelfModules rewrites requires that point at other evaluated blocks', (t) => {
  const created = [{ fileEval: './other', fileCreated: true, fileEvalHashPath: '/tmp/other.js' }];
  t.equal(mr.alterSelfModules("require('./other')", created), `require('${mr.toRequirePath('/tmp/other.js')}')`, 'a sibling block require points at its temp file');
  t.equal(mr.alterSelfModules("require('./other')", [{ fileEval: './other', fileCreated: false }]), "require('./other')", 'an uncreated block is left alone');
  t.end();
});

test('alterPrependModules resolves local requires against the prepend path', (t) => {
  t.equal(mr.alterPrependModules("require('./local')", [], '/proj'), `require('${mr.toRequirePath(path.resolve(path.join('/proj', './local')))}')`, 'a local require resolves against prepend');
  t.equal(mr.alterPrependModules("require('lodash')", [], '/proj'), "require('lodash')", 'a bare specifier is not a local require');
  t.end();
});

test('the alter functions skip requires that should not be rewritten', (t) => {
  t.equal(mr.alterNpmModules("require('fs')", [], '/proj'), "require('fs')", 'core modules are left alone');
  t.equal(mr.alterNpmModules("require('./local')", [], '/proj'), "require('./local')", 'local requires are not npm modules');
  const nodes = [{ fileEval: './sib', fileCreated: true, fileEvalHashPath: '/t/s.js' }];
  t.equal(mr.alterPrependModules("require('./sib')", nodes, '/proj'), "require('./sib')", 'a require mapping to a known block is left for alterSelfModules');
  t.end();
});

test('the alter functions handle exact names, absolutes, and default prepends', (t) => {
  const pkg = { name: 'mypkg', path: '/proj/package.json' };
  t.equal(mr.alterAssignedModule("require('mypkg')", '', pkg), `require('${mr.toRequirePath(path.dirname(path.resolve(pkg.path)))}')`, 'an exact package name maps to the module directory');
  t.equal(mr.alterSelfModules("require('./x')", [{ fileEval: './other', fileCreated: true }]), "require('./x')", 'a require with no matching block is left alone');
  t.equal(mr.alterNpmModules("require('/abs/mod')", [], '/proj'), "require('/abs/mod')", 'an absolute require is left alone');
  t.match(mr.alterNpmModules("require('lodash')", [], ''), /node_modules\/lodash/, 'an empty prepend defaults to the cwd for npm modules');
  t.match(mr.alterPrependModules("require('./x')", [], ''), /\/x'\)$/, 'an empty prepend defaults to the cwd for locals');
  t.end();
});

test('buildEvalable builds the preserve/concat variants and rewrites their modules', (t) => {
  const node = { content: "require('lodash');", startLine: 0 };
  const build = mr.buildEvalable(node, [], 1, false, '/proj');
  t.equal(build.concat, "require('lodash');", 'concat holds the raw content');
  t.match(build.concatAlter, /node_modules\/lodash/, 'concatAlter rewrites the npm require');
  t.end();
});
