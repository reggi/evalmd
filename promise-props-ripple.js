var _ = require('lodash')
var Promise = require('bluebird')

function promisePropsRipple (start, props) {
  props = (props) ? props : start
  start = (props) ? {} : start
  props = _.mapValues(props, function (prop, key) {
    prop.key = key
    return prop
  })
  return Promise.reduce(_.values(props), function (result, action) {
    if (typeof action !== 'function') throw new Error('property values must be functions')
    return Promise.resolve(action(start)).then(function (value) {
      start[action.key] = value
      return value
    })
  }, null)
  .then(function () {
    return start
  })
}

module.exports = promisePropsRipple

// promisePropsRipple({cookie: 'sugar'}, {
//   'alpha': function (data) {
//     return gamma(data.cookie)
//   },
//   'beta': function (data) {
//     return gamma(data.alpha)
//   },
//   'gamma': function (data) {
//     return gamma(data.beta)
//   },
//   'delta': function (data) {
//     return gamma(data.cookie, data.gamma)
//   },
// }).then(function (a){
//   console.log(a)
// })
