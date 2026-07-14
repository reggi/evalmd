'use strict';

const test = require('tape');
const createLogger = require('../src/log');

test('createLogger.info stores a tagged, stripped info line', (t) => {
  const logger = createLogger({ silence: true });
  logger.info('hello');
  t.equal(logger.store.length, 1, 'one line is stored');
  t.match(logger.store[0], /evalmd/, 'includes the evalmd tag');
  t.match(logger.store[0], /info/, 'includes the info level');
  t.match(logger.store[0], /hello/, 'includes the message');
  t.end();
});

test('createLogger.debug is gated on the debug option', (t) => {
  const quiet = createLogger({ silence: true, debug: false });
  quiet.debug('x');
  t.equal(quiet.store.length, 0, 'debug is a no-op when debug is off');

  const loud = createLogger({ silence: true, debug: true });
  loud.debug('x');
  t.equal(loud.store.length, 1, 'debug logs when debug is on');
  t.end();
});

test('createLogger.err splits a stack and stores each line tagged as ERR', (t) => {
  const logger = createLogger({ silence: true });
  const lines = logger.err(new Error('boom'));
  t.ok(Array.isArray(lines), 'returns the cleaned lines');
  t.ok(logger.store.length >= 1, 'stores at least one line');
  t.match(logger.store[0], /ERR!/, 'tags lines as errors');
  t.end();
});

test('cleanStack normalizes errors, arrays, strings, and falsy input', (t) => {
  t.deepEqual(createLogger.cleanStack(['a', 'b']), ['a', 'b'], 'passes arrays through');
  t.equal(createLogger.cleanStack(false), false, 'returns false for falsy input');
  t.ok(Array.isArray(createLogger.cleanStack(new Error('x'))), 'splits an Error into lines');
  t.deepEqual(createLogger.cleanStack('a\nb'), ['a', 'b'], 'splits a plain string into lines');
  t.end();
});

test('createLogger.err ignores falsy input', (t) => {
  const logger = createLogger({ silence: true });
  t.equal(logger.err(false), false, 'no lines are produced');
  t.equal(logger.store.length, 0, 'nothing is stored');
  t.end();
});

test('errMsg colors the first of several parts, and createLogger defaults its options', (t) => {
  const msg = createLogger.errMsg('label', 'detail');
  t.match(msg, /label/, 'includes the labeled first part');
  t.match(msg, /detail/, 'includes the rest');
  t.equal(createLogger().store.length, 0, 'a logger with no options starts empty');
  t.end();
});

test('createLogger writes to stderr when not silenced', (t) => {
  const orig = process.stderr.write;
  let wrote = '';
  process.stderr.write = (chunk) => {
    wrote += chunk;
    return true;
  };
  const logger = createLogger({ silence: false });
  logger.info('shown');
  process.stderr.write = orig;
  t.match(wrote, /shown/, 'the info line is written to stderr');
  t.equal(logger.store.length, 1, 'and is also stored');
  t.end();
});
