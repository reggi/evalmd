function promiseSeries (arr, cb) {
  var count = 0
  return arr.reduce(function (acc, action) {
    return acc.then(function (arrActive) {
      return Promise.resolve(cb(action, count, arrActive)).then(function (value) {
        arrActive[count] = value
        count = count + 1
        return arrActive
      })
    })
  }, Promise.resolve(arr))
}

module.exports = promiseSeries
