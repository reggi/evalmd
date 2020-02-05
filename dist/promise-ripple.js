var Promise = require('bluebird');
var values = require('object.values');
var entries = require('object.entries');
function promiseRipple(start, props) {
    props = props || start;
    start = props ? start : {};
    entries(props).forEach(function (_a) {
        var key = _a[0], prop = _a[1];
        prop.key = key;
    });
    return Promise.reduce(values(props), function (result, action) {
        if (typeof action !== 'function')
            throw new Error('property values must be functions');
        return Promise.resolve(action(start)).then(function (value) {
            if (start === value) {
                return value;
            }
            else {
                start[action.key] = value;
                return value;
            }
        });
    }, null)
        .then(function () {
        return start;
    });
}
module.exports = promiseRipple;
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
