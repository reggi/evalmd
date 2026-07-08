'use strict';

const arrayWith = require('array.prototype.with');

function promiseSeries (arr, cb) {
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
