'use strict';

const semver = require('semver');
const test = require('tape');
const main = require('../src/eval-markdown');

/*
 * eslint loads on some node versions it does not support, then fails inside a
 * dynamic `import()`, so its engines are the only reliable signal here.
 * `require.resolve` keeps the specifier opaque to `tsc`, which would otherwise
 * type-check eslint's declarations and break the es5 build.
 */
const canLoadEslint = semver.satisfies(process.version, require(require.resolve('eslint/package.json')).engines.node);

const PKG = './package.json';

function run(files, overrides) {
  const o = overrides || {};
  const has = (key, fallback) => (key in o ? o[key] : fallback);
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  const restore = () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
  return main(
    files,
    has('package', PKG),
    has('prepend', './'),
    has('blockScope', false),
    has('nonstop', false),
    has('preventEval', false),
    has('includePrevented', false),
    has('silence', true),
    has('debug', false),
    has('output', false),
    has('delimeter', false),
    o.evalLangs || ['js'],
    has('sloppy', false),
    has('useEslint', false)
  ).then((report) => {
    restore();
    return report;
  }, (err) => {
    restore();
    throw err;
  });
}

test('main evaluates a passing js readme', (t) => {
  run(['./test-readmes/win.md']).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.ok(Array.isArray(report.log), 'a log is returned');
    t.end();
  });
});

test('main evaluates js and sh blocks together', (t) => {
  run(['./test-readmes/sh.md'], { evalLangs: ['js', 'sh'] }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.end();
  });
});

test('main evaluates in sloppy mode', (t) => {
  run(['./test-readmes/sloppy.md'], { sloppy: true }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.end();
  });
});

test('main evaluates a self-contained block at block scope, unsilenced, with debug', (t) => {
  run(['./test-readmes/win.md'], { blockScope: true, silence: false, debug: true }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.end();
  });
});

test('main concatenates state-sharing blocks at the default scope', (t) => {
  run(['./test-readmes/fence-spaces.md']).then((report) => {
    t.equal(report.exitCode, 0, 'blocks sharing variables evaluate together');
    t.end();
  });
});

test('main outputs generated code in each output mode', (t) => {
  const modes = [true, 'preserve', 'concat', 'preserveAlter', 'concatAlter'];
  const step = (index) => {
    if (index >= modes.length) { return t.end(); }
    return run(['./test-readmes/win.md'], { output: modes[index], delimeter: true }).then((report) => {
      t.equal(report.exitCode, 0, `output mode ${String(modes[index])} exits 0`);
      return step(index + 1);
    });
  };
  step(0);
});

test('main with a string delimeter and block scope output', (t) => {
  run(['./test-readmes/win.md'], { output: 'preserve', delimeter: '---', blockScope: true }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.end();
  });
});

test('main skips evaluation when preventEval is set', (t) => {
  run(['./test-readmes/win.md'], { preventEval: true }).then((report) => {
    t.equal(report.exitCode, 0, 'nothing runs, exit code is 0');
    t.end();
  });
});

test('main includes prevented blocks when asked', (t) => {
  run(['./test-readmes/win.md'], { includePrevented: true }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0');
    t.end();
  });
});

test('main reports no blocks to eval when a kind has none', (t) => {
  run(['./test-readmes/win.md'], { evalLangs: ['sh'] }).then((report) => {
    t.equal(report.exitCode, 0, 'exit code is 0 with nothing to run');
    t.end();
  });
});

test('main returns exit code 1 for a throwing block when nonstop', (t) => {
  run(['./test-readmes/error.md'], { nonstop: true }).then((report) => {
    t.equal(report.exitCode, 1, 'a failed assertion yields exit code 1');
    t.end();
  });
});

test('main rejects to exit code 1 for a throwing block when not nonstop', (t) => {
  run(['./test-readmes/error.md']).then((report) => {
    t.equal(report.exitCode, 1, 'the run bails with exit code 1');
    t.equal(report.log, null, 'no log survives the failure');
    t.end();
  });
});

test('main returns exit code 1 for a missing file', (t) => {
  run(['./test-readmes/does-not-exist.md']).then((report) => {
    t.equal(report.exitCode, 1, 'a missing file bails with exit code 1');
    t.end();
  });
});

test('main derives block parsers from the eslint config when useEslint is set', { skip: !canLoadEslint }, (t) => {
  run(['./test-readmes/win.md'], { useEslint: true }).then((report) => {
    t.equal(report.exitCode, 0, 'the eslint-derived parser evaluates the block');
    t.end();
  });
});

test('main swallows a syntax error under nonstop and reports it otherwise', (t) => {
  run(['./test-readmes/syntax-error.md'], { nonstop: true }).then((swallowed) => {
    t.equal(swallowed.exitCode, 0, 'nonstop keeps going past an unparseable block');
    return run(['./test-readmes/syntax-error.md']);
  }).then((thrown) => {
    t.equal(thrown.exitCode, 1, 'a parse error otherwise bails with exit code 1');
    t.end();
  });
});

test('main returns exit code 1 for a failing shell block', (t) => {
  run(['./test-readmes/sh-fail.md'], { evalLangs: ['sh'], nonstop: true }).then((nonstop) => {
    t.equal(nonstop.exitCode, 1, 'a mismatched sh block fails under nonstop');
    return run(['./test-readmes/sh-fail.md'], { evalLangs: ['sh'] });
  }).then((thrown) => {
    t.equal(thrown.exitCode, 1, 'a mismatched sh block fails otherwise');
    t.end();
  });
});

test('main tolerates a missing package.json', (t) => {
  run(['./test-readmes/sh.md'], { package: './does-not-exist.json', evalLangs: ['js'] }).then((report) => {
    t.equal(report.exitCode, 0, 'a core-module-only block runs without a package');
    t.end();
  });
});

test('main outputs even when a block fails to build, under nonstop', (t) => {
  run(['./test-readmes/syntax-error.md'], { output: 'preserve', nonstop: true }).then((report) => {
    t.equal(report.exitCode, 0, 'output mode skips the unbuildable block and keeps going');
    t.end();
  });
});

test('main dispatches an unknown block kind to an empty result', (t) => {
  run(['./test-readmes/win.md'], { evalLangs: ['foo'] }).then((report) => {
    t.equal(report.exitCode, 0, 'a kind with no registered langs runs nothing');
    t.end();
  });
});

test('main writes evaluated block stdout through', (t) => {
  run(['./test-readmes/log-output.md']).then((report) => {
    t.equal(report.exitCode, 0, 'a block that prints still exits 0');
    t.end();
  });
});

test('main ignores an unrecognized output mode', (t) => {
  run(['./test-readmes/win.md'], { output: 'bogus' }).then((report) => {
    t.equal(report.exitCode, 0, 'an unknown output mode writes nothing and still evaluates');
    t.end();
  });
});
