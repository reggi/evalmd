var _ = require('lodash')
var path = require('path')
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
function testMarkdown (prividedPath) {
  return fs.readFileAsync('./package.json')
  .then(JSON.parse)
  .catch(function () {
    return false
  })
  .then(function (pkg) {
    return fs.lstatAsync(prividedPath)
    .then(function (stats) {
      if (stats.isFile()) {
        return testMarkdown.files(prividedPath, pkg)
      } else if (stats.isDirectory()) {
        return fs.readdirAsync(prividedPath)
        .then(function (files) {
          return testMarkdown.prependPaths(files, prividedPath)
        })
        .then(function (dirPaths) {
          return testMarkdown.files(dirPaths, pkg)
        })
      }
    }).then(function () {
      return process.exit()
    })
  })
}

/** prepends array items with dir path */
testMarkdown.prependPaths = function (files, dir) {
  return _.map(files, function (file) {
    return path.join(dir, file)
  })
}

/** takes array of files, parses md, parses html, html entities, evals */
testMarkdown.files = function (files, pkg) {
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
      _.each(deps, function (dep) {
        if (pkg && pkg.main && dep.source.value === pkg.name) {
          var start = charsAdded + dep.source.start + 1
          var end = charsAdded + dep.source.end - 1
          code = testMarkdown.replacePosition(code, start, end, pkg.main)
          charsAdded += Math.abs(pkg.main.length - dep.source.value.length)
        }
      })
      var parsed = path.parse(file)
      parsed.format = path.format(parsed)
      return _eval(code, parsed.format, {}, true)
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
    codeHtml.push($(this).html())
  })
  return codeHtml.join('\n')
}

module.exports = testMarkdown
