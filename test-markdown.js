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
  return fs.lstatAsync(prividedPath)
  .then(function (stats) {
    if (stats.isFile()) {
      return testMarkdown.files(prividedPath)
    } else if (stats.isDirectory()) {
      return fs.readdirAsync(prividedPath)
      .then(function (files) {
        return testMarkdown.prependPaths(files, prividedPath)
      })
      .then(testMarkdown.files)
    }
  }).then(function () {
    return process.exit()
  })
}

/** prepends array items with dir path */
testMarkdown.prependPaths = function (files, dir) {
  return _.map(files, function (file) {
    return path.join(dir, file)
  })
}

/** takes array of files, parses md, parses html, html entities, evals */
testMarkdown.files = function (files) {
  files = _.flatten([files])
  return Promise.map(files, function (file) {
    return fs.readFileAsync(file, 'utf8')
    .then(markedAsync)
    .then(testMarkdown.getJsFromHTML)
    .then(entities.decode)
    .then(function (code) {
      var parsed = path.parse(file)
      parsed.format = path.format(parsed)
      return _eval(code, parsed.format, {}, true)
    })
  })
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
