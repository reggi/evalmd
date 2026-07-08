'use strict';

const arrayWith = require('array.prototype.with');

/**
 * @template T
 * @param {readonly T[]} arr
 * @param {(action: T, count: number, arrActive: readonly T[]) => T | Promise<T>} cb
 * @returns {Promise<readonly T[]>}
 */
function promiseSeries(arr, cb) {
  let count = 0;
  return arr.reduce((acc, action) => acc.then((arrActive) => Promise.resolve(cb(action, count, arrActive)).then((value) => {
    count += 1;
    return arrayWith(arrActive, count - 1, value);
  })), Promise.resolve(arr));
}

module.exports = promiseSeries;
