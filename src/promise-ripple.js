var entries = require('object.entries')

/**
 * @template {object} T
 * @param {T} start
 * @param {Record<string, ((data: T) => unknown) & { key?: string }>} props
 * @returns {Promise<T>}
 */
function promiseRipple (start, props) {
  /** @type {Promise<unknown>} */
  var seed = Promise.resolve(null)
  return entries(props).reduce(function (acc, [key, action]) {
    return acc.then(function () {
      if (typeof action !== 'function') {
        throw new Error('property values must be functions')
      }
      var fn = /** @type {(data: object) => unknown} */ (action)
      return Promise.resolve(fn(start)).then(function (value) {
        if (start === value) {
          return value
        } else {
          Object.assign(start, { [key]: value })
          return value
        }
      })
    })
  }, seed)
  .then(function () {
    return start
  })
}

module.exports = promiseRipple

// promiseRipple({zero: 'zero'}, {
//   'alpha': function (data) {
//     return Promise.resolve(data.zero + ' alpha') // async -> 'zero alpha'
//   },
//   'beta': function (data) {
//     data.foo = 'foo'
//     data.bar = 'bar'
//     return data
//   },
//   'gamma': function (data) {
//     return Promise.resolve(data.zero + ' gamma') // async -> 'zero gamma'
//   },
//   'delta': function (data) {
//     return Promise.resolve(data.zero + data.alpha + ' delta') // async -> 'zerozero alpha delta'
//   },
// }).then(function (results) {
//   console.log(results)
// })
