'use strict';

const childProcess = require('child_process');
const path = require('path');
const url = require('url');
const acorn = require('acorn');
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

test('alterAssignedModule resolves the package self-reference through its exports', (t) => {
  const pkgPath = path.resolve('test/fixtures/exports-pkg/package.json');
  const pkg = { name: 'exports-pkg', path: pkgPath, exports: {} };
  const dir = path.dirname(pkgPath);
  t.equal(
    mr.alterAssignedModule("import x from 'exports-pkg';", '', pkg),
    `import x from '${url.pathToFileURL(path.join(dir, 'esm.mjs')).href}';`,
    'an import uses the import condition, as a file URL',
  );
  t.equal(
    mr.alterAssignedModule("require('exports-pkg')", '', pkg),
    `require('${mr.toRequirePath(path.join(dir, 'cjs.js'))}')`,
    'a require uses the require condition',
  );
  t.equal(
    mr.alterAssignedModule("require('exports-pkg/sub')", '', pkg),
    `require('${mr.toRequirePath(path.join(dir, 'sub.js'))}')`,
    'an exported subpath resolves to its target',
  );
  t.throws(
    () => mr.alterAssignedModule("require('exports-pkg/nope')", '', pkg),
    (e) => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    'an unexported subpath throws',
  );
  t.end();
});

test('alterNpmModules leaves a file URL alone', (t) => {
  t.equal(mr.alterNpmModules("import x from 'file:///proj/x.mjs';", [], '/proj'), "import x from 'file:///proj/x.mjs';", 'a file URL is not an npm specifier');
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

const parseLatest = (code) => acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest' });
const runModule = (code) => childProcess.spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });

test('alterExpectedThrows expects a `// throws` statement to throw', (t) => {
  const passing = "JSON.parse('{'); // throws\nvar after = 1;";
  const altered = mr.alterExpectedThrows(passing);
  t.notEqual(altered, passing, 'the statement is rewritten');
  t.equal(altered.split('\n').length, passing.split('\n').length, 'no lines are added');
  t.equal(runModule(altered).status, 0, 'a statement that throws passes');

  const failing = runModule(mr.alterExpectedThrows('JSON.parse(\'{}\'); // Throws (no, it does not)'));
  t.notEqual(failing.status, 0, 'a statement that does not throw fails');
  t.match(failing.stderr, /expected `JSON\.parse\('\{\}'\);` to throw/, 'the failure names the statement');

  const untouched = "JSON.parse('{}'); // returns an object\nJSON.parse('{}');\n// throws\nvar x = 1; // throws";
  t.equal(mr.alterExpectedThrows(untouched), untouched, 'other comments, a comment on its own line, and declarations are left alone');
  t.ok(mr.alterExpectedThrows('f(); g(); // throws').startsWith('f(); { '), 'an earlier statement on the same line is left alone');
  t.equal(mr.alterExpectedThrows('f(); // throws', { parse: () => ({ type: 'X' }) }), 'f(); // throws', 'a parse result with no body is left alone');
  t.end();
});

test('alterExpectedThrows awaits a `// throws` statement with a top-level await', (t) => {
  const rejects = 'async function reject() { throw new Error(); }\nawait reject(); // throws';
  const resolves = 'async function resolve() {}\nawait resolve(); // throws';
  const nested = 'async function reject() { throw new Error(); }\n[async () => { await reject(); }].forEach((f) => f()); // throws';
  t.ok(mr.alterExpectedThrows(nested, { parse: parseLatest }).indexOf('await (async') === -1, 'an await inside a nested function is not top-level');
  t.equal(runModule(mr.alterExpectedThrows(rejects, { parse: parseLatest })).status, 0, 'a rejection passes');
  const resolved = runModule(mr.alterExpectedThrows(resolves, { parse: parseLatest }));
  t.notEqual(resolved.status, 0, 'a resolution fails');
  t.match(resolved.stderr, /expected `await resolve\(\);` to throw/, 'the failure names the statement');
  t.end();
});

test('buildEvalable builds the preserve/concat variants and rewrites their modules', (t) => {
  const node = { content: "require('lodash');", startLine: 0 };
  const build = mr.buildEvalable(node, [], 1, false, '/proj');
  t.equal(build.concat, "require('lodash');", 'concat holds the raw content');
  t.match(build.concatAlter, /node_modules\/lodash/, 'concatAlter rewrites the npm require');
  t.end();
});
