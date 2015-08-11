var util = require('util')
var _ = require('lodash')

/** assemble a bin help output from a object */
function binDoc (def) {
  if (def.usage) def.usage = binDoc.buildUsage(def.usage, def.name)
  if (def.options) def.options = binDoc.buildOptions(def.options, def.optionAliases)
  var merger = []
  if (def.usage) merger.push(def.usage)
  if (def.options) merger.push(_.values(def.options))
  merger = _.flatten(merger)
  var longestString = binDoc.longestString(_.map(merger, 'field')) + 2
  var output = []
  var intro = []
  if (def.name) intro.push(def.name)
  if (def.description) intro.push(def.description)
  output.push('')
  output.push(intro.join(' - '))
  output.push('')
  if (def.usage) output.push('Usage:')
  _.each(def.usage, function (item) {
    output.push(util.format('    %s%s%s', item.field, binDoc.calculateSpaces(item.field, longestString), item.desc))
  })
  if (def.options) output.push(''); output.push('Options:')
  _.each(def.options, function (item) {
    output.push(util.format('    %s%s%s', item.field, binDoc.calculateSpaces(item.field, longestString), item.desc))
  })
  output.push('')
  return output.join('\n')
}

/** given an array, will return char count of longest string */
binDoc.longestString = function (arr) {
  var result = _.chain(arr)
  .map(function (item) {
    return item.length
  })
  .sortBy(function (num) {
    return num
  })
  .last()
  .value()
  return result || 0
}

/** calculate spaces in betwee field and desc */
binDoc.calculateSpaces = function (str, max) {
  var spacesNeeded = max - str.length
  return _.chain(spacesNeeded)
  .range()
  .map(function () {
    return ' '
  })
  .value()
  .join('')
}

/** build usage object */
binDoc.buildUsage = function (descriptions, name) {
  return _.chain(descriptions)
  .map(function (description, key) {
    return {
      'field': name + ' ' + key,
      'desc': description
    }
  })
  .value()
}

/** prefix array items */
binDoc.prefixItems = function (arr, prefix) {
  return _.chain(arr)
  .map(function (item) {
    if (item.substr(0, 1) === '-') return item
    return prefix + item
  })
  .value()
}

/** build options object */
binDoc.buildOptions = function (descriptions, aliases) {
  if (!aliases) aliases = {}
  return _.chain(descriptions)
  .mapValues(function (description, key) {
    var keys = (aliases[key]) ? _.flatten([key, aliases[key]]) : [key]
    keys = binDoc.prefixItems(keys, '--')
    return {
      'field': keys.join(' | '),
      'desc': description
    }
  })
  .value()
}

module.exports = binDoc
