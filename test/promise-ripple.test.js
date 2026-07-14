'use strict';

const test = require('tape');
const promiseRipple = require('../src/promise-ripple');

test('promiseRipple threads results onto the seed object in order', (t) => {
  promiseRipple({ zero: 0 }, {
    one(data) { return data.zero + 1; },
    two(data) { return Promise.resolve(data.one + 1); },
  }).then((result) => {
    t.equal(result.one, 1, 'the first property is assigned');
    t.equal(result.two, 2, 'a later property sees earlier results');
    t.end();
  });
});

test('promiseRipple rejects when a property value is not a function', (t) => {
  promiseRipple({}, { bad: 42 }).then(() => {
    t.fail('should not resolve');
    t.end();
  }, (err) => {
    t.match(err.message, /must be functions/, 'reports the contract violation');
    t.end();
  });
});
