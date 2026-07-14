'use strict';

const test = require('tape');
const evalRun = require('../src/eval-run');

function fakeLogger() {
  const calls = [];
  return {
    calls,
    info() { return undefined; },
    debug() { return undefined; },
    err(err) { calls.push(err); },
  };
}

test('getCleanErr prefers the stack wrapper when given one', (t) => {
  t.equal(evalRun.getCleanErr('boom', () => 'wrapped'), 'wrapped', 'the wrapper result is returned');
  t.end();
});

test('getCleanErr falls back to an Error stack, then the value itself', (t) => {
  const err = new Error('nope');
  t.equal(evalRun.getCleanErr(err), err.stack, 'an Error yields its stack');
  t.equal(evalRun.getCleanErr('plain'), 'plain', 'a non-Error value is returned unchanged');
  t.end();
});

test('nonstopErr logs and returns the error when nonstop is set', (t) => {
  const logger = fakeLogger();
  const result = evalRun.nonstopErr('boom', undefined, true, logger);
  t.equal(result, 'boom', 'the original error is returned');
  t.deepEqual(logger.calls, ['boom'], 'the cleaned error is logged');
  t.end();
});

test('nonstopErr throws the cleaned error when nonstop is not set', (t) => {
  const logger = fakeLogger();
  t.throws(() => evalRun.nonstopErr('boom', undefined, false, logger), 'the error propagates');
  t.deepEqual(logger.calls, [], 'nothing is logged');
  t.end();
});

test('evaluateKind resolves to an empty list for a non-shell kind', (t) => {
  evalRun.evaluateKind('js', [], 'file.md', false, fakeLogger()).then((result) => {
    t.deepEqual(result, [], 'unknown kinds evaluate to nothing');
    t.end();
  });
});
