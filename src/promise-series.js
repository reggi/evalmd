'use strict';

const arrayWith = require('array.prototype.with');

/**
 * @template T
 * @param {readonly T[]} arr
 * @param {(action: T, count: number, arrActive: readonly T[]) => T | Promise<T>} cb
 * @returns {Promise<readonly T[]>}
 */
function promiseSeries(arr, cb) {
  var count = 0
  return arr.reduce(function (acc, action) {
    return acc.then(function (arrActive) {
      return Promise.resolve(cb(action, count, arrActive)).then(function (value) {
        count += 1
        return arrayWith(arrActive, count - 1, value);
      })
    })
  }, Promise.resolve(arr))
}

module.exports = promiseSeries
