var path = require('path')
var _ = require('lodash')
var Entities = require('html-entities').AllHtmlEntities
var cheerio = require('cheerio')
var marked = require('marked')
var Promise = require('bluebird')
var fs = Promise.promisifyAll(require('fs'))
var markedAsync = Promise.promisify(marked)
var _eval = require('eval')
var entities = new Entities()
var acorn = require('acorn')
var umd = require('acorn-umd')

/**
 * :fishing_pole_and_fish: Evaluates javascript code blocks from markdown files.
 * @module evalmd
 * @package.keywords eval, evaulate, javascript, markdown, test
 * @package.preferGlobal
 * @package.scripts.test ./bin/test-markdown.js ./README.md
 * @package.bin.evalmd ./bin/test-markdown.js
 */

/** evaluates a dir of md files or a single file */
function testMarkdown (files, output, prepend) {
  return fs.readFileAsync('./package.json')
  .then(JSON.parse)
  .catch(function () { return false })
  .then(function (pkg) {
    return testMarkdown.files(files, pkg, prepend)
  })
  .then(function (code) {
    if (output) console.log(JSON.stringify(code))
    return process.exit()
  })
}

/** takes array of files, parses md, parses html, html entities, evals */
testMarkdown.files = function (files, pkg, prepend) {
  files = _.flatten([files])
  return Promise.map(files, function (file) {
    return fs.readFileAsync(file, 'utf8')
    .then(markedAsync)
    .then(testMarkdown.getJsFromHTML)
    .then(entities.decode)
    .then(function (code) {
      var ast = acorn.parse(code, {ecmaVersion: 6})
      var deps = umd(ast, {
        es6: true, amd: true, cjs: true
      })
      var charsAdded = 0
      // change package if required
      _.each(deps, function (dep) {
        if (pkg && pkg.main && dep.source.value === pkg.name) {
          var start = charsAdded + dep.source.start + 1
          var end = charsAdded + dep.source.end - 1
          code = testMarkdown.replacePosition(code, start, end, pkg.main)
          charsAdded += Math.abs(pkg.main.length - dep.source.value.length)
        }
      })
      // prefix local modules with dir
      if (prepend) {
        var localRegex = /^.\.\/|^.\/|^\//
        _.each(deps, function (dep) {
          if (dep.source.value.match(localRegex)) {
            var start = charsAdded + dep.source.start + 1
            var end = charsAdded + dep.source.end - 1
            var newRef = path.join(prepend, dep.source.value)
            code = testMarkdown.replacePosition(code, start, end, newRef)
            charsAdded += Math.abs(newRef.length - dep.source.value.length)
          }
        })
      }
      _eval(code, file, {}, true)
      return code
    })
  })
}

/** replaces the string in palce */
testMarkdown.replacePosition = function (str, start, end, value) {
  return str.substr(0, start) + value + str.substr(end)
}

/** selecting the js code html blocks in the dom */
testMarkdown.getJsFromHTML = function (mdContent) {
  var $ = cheerio.load(mdContent, {decodeEntities: false})
  var code = $('code.lang-javascript, code.lang-js')
  var codeHtml = []
  code.map(function () {
    var block = $(this).html()
    if (!block.match(/^\/\/ prevent eval/)) codeHtml.push(block)
  })
  return codeHtml.join('\n')
}

module.exports = testMarkdown
