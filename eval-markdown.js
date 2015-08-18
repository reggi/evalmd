var crypto = require('crypto')
var path = require('path')
var _ = require('lodash')
var cheerio = require('cheerio')
var marked = require('marked')
var Promise = require('bluebird')
var fs = Promise.promisifyAll(require('fs-extra'))
var markedAsync = Promise.promisify(marked)
var _eval = require('eval')
var acorn = require('acorn')
var umd = require('acorn-umd')
var chalk = require('chalk')
var S = require('underscore.string')
var os = require('os')
var promisePropsRipple = require('./promise-props-ripple')

/**
 * :fishing_pole_and_fish: Evaluates javascript code blocks from markdown files.
 * @module evalmd
 * @package.keywords eval, evaulate, javascript, markdown, test
 * @package.preferGlobal
 * @package.bin.evalmd ./bin/eval-markdown.js
 * @package.bin.test-markdown ./bin/eval-markdown.js
 * @package.bin.eval-markdown ./bin/eval-markdown.js
 */
function evalMarkdown (file$, prependPath, uniformPath, nonstop, blockScope, silence, preventEval, includePrevented, output, stdoutDelimeter, packagePath) {
  evalMarkdown.log = evalMarkdown.writeStderr(evalMarkdown.stderr, silence)
  evalMarkdown.logInfo('it worked if it ends with', 'ok')
  var files = _.flatten([file$])
  packagePath = (packagePath) ? packagePath : './package.json'
  return fs.readFileAsync(packagePath)
  .then(JSON.parse)
  .catch(function () { return false })
  .then(function (pkg) {
    if (pkg) {
      evalMarkdown.logInfo(packagePath, 'found ' + pkg.name)
    } else {
      evalMarkdown.logInfo(packagePath, 'not found')
    }
    return pkg
  })
  .then(function (pkg) {
    var halt = false
    return Promise.map(files, function (fileName) {
      if (halt) return {}
      return promisePropsRipple({
        mdContent: function (data) {
          return fs.readFileAsync(fileName, 'utf8')
        },
        mdContentLines: function (data) {
          return S.lines(data.mdContent)
        },
        mdReference: function (data) {
          return data.mdContent
          .replace(/```\n/g, '\n// TERMINATEDCODEBLOCK\n```\n') // https://github.com/chjj/marked/issues/645
          // .replace(/ {4}/g, '\t') // https://github.com/chjj/marked/issues/644
        },
        html: function (data) {
          return markedAsync(data.mdReference)
        },
        blocks: function (data) {
          var blockCounter = {}
          var blocks = evalMarkdown.getBlocks(data.html, data.mdReference, pkg)
          blocks = _.map(blocks, function (block, id) {
            block.id = id + 1
            block = evalMarkdown.assembleBlock(block, blockCounter, data.mdContent, data.mdContentLines, data.mdReference, includePrevented)
            var temp = path.join(os.tmpdir(), 'evalmd')
            block.assignFileHashPath = (block.assignFileHash) ? path.join(temp, block.assignFileHash) : undefined
            if (block.assignFileHashPath) blockScope = true
            return block
          })
          return blocks
        },
        writeBlockfiles: function (data) {
          return Promise.map(data.blocks, function (block) {
            if (block.assignFileHashPath) {
              return fs.mkdirsAsync(path.dirname(block.assignFileHashPath)).then(function () {
                return fs.writeFileAsync(block.assignFileHashPath, block.asFile)
              })
            } else {
              return undefined
            }
          })
        },
        jsFile: function (data) {
          return evalMarkdown.jsFile(data.blocks, data.mdContentLines)
        },
        evaluations: function (data) {
          if (preventEval) {
            var evaluations = []
            evaluations.preventEval = true
            return evaluations
          }
          return evalMarkdown.evaluations(data.blocks, data.jsFile, fileName, pkg, prependPath, uniformPath, nonstop, blockScope)
        },
        removeBlockFiles: function (data) {
          return Promise.map(data.blocks, function (block) {
            if (block.assignFileHashPath) {
              return fs.removeAsync(block.assignFileHashPath)
            } else {
              return undefined
            }
          })
        }
      }).then(function (data) {
        var haltedHappened = _.map(data.evaluations, 'halted')
        if (_.contains(haltedHappened, true)) halt = true
        stdoutDelimeter = (stdoutDelimeter === true) ? '//EVALMD-STDOUT-FILE-DELIMETER' : stdoutDelimeter
        if (output && blockScope) {
          _.each(data.blocks, function (block) {
            process.stdout.write(block.asFile)
            if (stdoutDelimeter) process.stdout.write(stdoutDelimeter)
          })
        } else if (output) {
          process.stdout.write(data.jsFile)
          if (stdoutDelimeter) process.stdout.write(stdoutDelimeter)
        }
        return data
      })
    }, {concurrency: 1})
  }).then(function (dataSets) {
    evalMarkdown.logInfo('ok')
    var exitCode = evalMarkdown.exitCode(dataSets)
    var values = {
      dataSets: dataSets,
      exitCode: exitCode,
      log: evalMarkdown.stderr
    }
    return values
  })
}

/** returns the exit code for the process based on errors */
evalMarkdown.exitCode = function (dataSets) {
  var errors = _.chain(dataSets).map(function (data) {
    return _.map(data.evaluations, 'error')
  }).flatten().without(false).value()
  return (errors.length) ? 1 : 0
}

/** a wrapper for writing to stderr and storing messages */
evalMarkdown.writeStderr = function (store, silence) {
  return function (data, type) {
    var colorLessData = chalk.stripColor(data)
    if (!store.all) store.all = []
    store.all.push(colorLessData)
    if (type && !store[type]) store[type] = []
    if (type) store[type].push(colorLessData)
    if (!silence) process.stderr.write(data)
  }
}

/** standard error storage */
evalMarkdown.stderr = {}

/** a log wrapper for stderr */
evalMarkdown.log = evalMarkdown.writeStderr(evalMarkdown.stderr)

/** traverse the html tree and get js code blocks */
evalMarkdown.getBlocks = function (html) {
  var $ = cheerio.load(html, {
    decodeEntities: true,
    normalizeWhitespace: false
  })
  var code = $('code.lang-javascript, code.lang-js')
  return code.map(function (i, elm) {
    var block = {}
    var $this = $(this)
    var target = $this.parent().prev().children().eq(0)
    block.prevSiblingTag = target[0] ? target[0].name : undefined
    block.prevSiblingHref = target.attr('href')
    block.prevSiblingContent = target.text()
    block.parentTag = this.name
    block.parentClass = $this.attr('class')
    block.code = $this.html()
    return block
  })
  .get()
}

/** string.indexOf with duplicate support */
evalMarkdown.multiIndexOf = function (s, ss) {
  var instances = S.count(s, ss)
  return _.chain(instances)
  .range()
  .reduce(function (indexes, instance) {
    var lastIndex = _.last(indexes)
    var start = (!lastIndex) ? 0 : lastIndex + ss.length
    var index = s.indexOf(ss, start)
    indexes.push(index)
    return indexes
  }, [])
  .value()
}

/** returns a md5 hash of the content */
evalMarkdown.hashBlock = function (content) {
  var shasum = crypto.createHash('md5')
  return shasum.update(content).digest('hex')
}

/** get line number of a ss or char */
evalMarkdown.getLineNumber = function (body, charOrString) {
  if (typeof body === 'undefined') return false
  if (typeof body === 'undefined') return false
  var char = (typeof charOrString === 'string') ? body.indexOf(charOrString) : charOrString
  var subBody = body.substring(0, char)
  if (subBody === '') return 1
  var match = subBody.match(/\n/gi)
  if (match) return match.length + 1
  return 1
}

/** collect all the information about a code block */
evalMarkdown.assembleBlock = function (block, blockCounter, mdContent, mdContentLines, mdReference, includePrevented) {
  block.prevent = [
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/prevent eval/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/preventeval/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/evalprevent/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/eval prevent/i)),
    Boolean(block.code.match(/^\/\/ prevent eval/i)),
    Boolean(block.code.match(/^\/\/ preventeval/i)),
    Boolean(block.code.match(/^\/\/ eval prevent/i)),
    Boolean(block.code.match(/^\/\/ evalprevent/i))
  ]

  block.assignFileViaSibling = [
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/file eval/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/fileeval/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/eval file/i)),
    Boolean(block.prevSiblingHref && block.prevSiblingHref.match(/evalfile/i))
  ]

  block.assignFileViaComment = block.code.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)

  if (_.contains(block.assignFileViaSibling, true)) {
    block.assignFile = block.prevSiblingContent
  } else if (block.assignFileViaComment) {
    block.assignFile = block.assignFileViaComment[2]
  }

  block.assignFileHash = (block.assignFile) ? evalMarkdown.hashBlock(block.assignFile) + '.js' : block.assignFile

  block.codeLines = S.lines(block.code)
  block.blockSyntaxTypes = {
    'lang-javascript': '```javascript',
    'lang-js': '```js'
  }
  block.codeMatchable = S.unescapeHTML(block.code)
  block.codeMatchable = block.codeMatchable
  // .replace(/ {4}/g, '\t')
  .replace(/\n\/\/ TERMINATEDCODEBLOCK\n$/, '')
  .replace(/\r\n/, '\n')
  .replace(/\r/, '\n')
  block.codeEvalable = S.unescapeHTML(block.code)
  .replace(/\n\/\/ TERMINATEDCODEBLOCK\n$/, '')

  mdReference = mdReference
  .replace(/\n\/\/ TERMINATEDCODEBLOCK\n/g, '')

  block.codeEvalableLines = S.lines(block.codeEvalable)
  block.blockSyntax = block.blockSyntaxTypes[block.parentClass]
  block.codeMatchable = [block.blockSyntax, '\n', block.codeMatchable, '```'].join('')
  block.hash = evalMarkdown.hashBlock(block.codeMatchable)
  block.multiIndexOf = evalMarkdown.multiIndexOf(mdReference, block.codeMatchable)

  if (typeof blockCounter[block.hash] === 'undefined') {
    blockCounter[block.hash] = 0
  } else {
    blockCounter[block.hash]++
  }
  block.startChar = block.multiIndexOf[blockCounter[block.hash]]
  block.startLine = evalMarkdown.getLineNumber(mdContent, block.startChar)
  block.endLine = block.startLine + block.codeEvalableLines.length
  block.pullCode = _.slice(mdContentLines, block.startLine, block.endLine)

  block.pullCodeLastLine = _.last(block.pullCode)
  if (block.pullCodeLastLine.match(/```$/)) {
    block.pullCode.pop()
    block.pullCodeLastLine = block.pullCodeLastLine.replace(/```$/, '')
    block.pullCode.push(block.pullCodeLastLine)
  }
  block.pullCode = block.pullCode.join('\n')
  block.prevent = (includePrevented) ? false : _.contains(block.prevent, true)
  block.asFile = _.range(mdContentLines.length).map(function () {return ''})
  block.asFile = evalMarkdown.replaceItems(block.startLine, block.asFile, block.pullCode).join('\n')
  return block
}

/** replace items in array stating with index */
evalMarkdown.replaceItems = function (start, main, sub) {
  main = (Array.isArray(main)) ? main : main.split('\n')
  sub = (Array.isArray(sub)) ? sub : sub.split('\n')
  var output = _.flatten([_.slice(main, 0, start), sub, _.slice(main, start + sub.length, main.length)])
  return output
}

/** assemble the javascrpt document */
evalMarkdown.jsFile = function (blocks, mdContentLines) {
  var numlines = mdContentLines.length
  var jsFile = _.range(numlines).map(function () {
    return ''
  })
  _.each(blocks, function (block) {
    if (!block.prevent && block.startLine) {
      jsFile = evalMarkdown.replaceItems(block.startLine, jsFile, block.pullCode)
    }
  })
  if (jsFile.length !== numlines) {
    // var parsedName = path.parse(dataSet.fileName)
    // var jsFile = parsedName.dir + parsedName.name + '.js'
    // fs.writeFileSync(jsFile, emptyDoc.join('\n'))
    // really should not be happening :)
    throw new Error('internal error incorrect doc assembly contact maintainer directly <thomas@reggi.com>')
  }
  return jsFile.join('\n')
}

/** replace a string in a position */
evalMarkdown.replacePosition = function (str, start, end, value) {
  return str.substr(0, start) + value + str.substr(end)
}

/** parse over the source and manipulate module definitions */
evalMarkdown.moduleParser = function (blocks, code, pkg, prependPath) {
  prependPath = prependPath || './'
  var localRegex = /^.\.\/|^.\//
  var ast = acorn.parse(code, {ecmaVersion: 6})
  var deps = umd(ast, {
    es6: true, amd: true, cjs: true
  })
  var charsAddedModuleName = 0
  // change package if required
  if (pkg && pkg.main) {
    _.each(deps, function (dep) {
      if (dep.source.value === pkg.name) {
        var start = charsAddedModuleName + dep.source.start + 1
        var end = charsAddedModuleName + dep.source.end - 1
        var main = path.join(prependPath, pkg.main)
        if (!main.match(/^\/|\.+\//)) main = './' + main
        code = evalMarkdown.replacePosition(code, start, end, main)
        charsAddedModuleName += Math.abs(pkg.main.length - dep.source.value.length)
      }
    })
  }

  var charsSelfModules = 0
  // convert self module def to absolute tmp file
  _.each(deps, function (dep) {
    if (dep.source.value) {
      var foundBlock = _.find(blocks, {
        'assignFile': dep.source.value
      })
      if (foundBlock) {
        var start = charsSelfModules + dep.source.start + 1
        var end = charsSelfModules + dep.source.end - 1
        var newRef = foundBlock.assignFileHashPath
        code = evalMarkdown.replacePosition(code, start, end, newRef)
        charsSelfModules += Math.abs(newRef.length - dep.source.value.length)
      }
    }
  })

  var charsAddedPrepend = 0
  // prefix local modules with dir
  if (prependPath) {
    _.each(deps, function (dep) {
      if (dep.source.value && dep.source.value.match(localRegex)) {
        var foundBlock = _.find(blocks, {
          'assignFile': dep.source.value
        })
        if (!foundBlock) {
          var start = charsAddedPrepend + dep.source.start + 1
          var end = charsAddedPrepend + dep.source.end - 1
          var newRef = path.join(prependPath, dep.source.value)
          if (!newRef.match(/^\/|\.+\//)) newRef = './' + newRef
          code = evalMarkdown.replacePosition(code, start, end, newRef)
          charsAddedPrepend += Math.abs(newRef.length - dep.source.value.length)
        }
      }
    })
  }
  return code
}

/** find block with given line */
evalMarkdown.findErrorBlock = function (items, line) {
  return _.find(items, function (item) {
    return item.startLine <= line && item.endLine >= line
  })
}

/** get the stack with the file lines */
evalMarkdown.stackParts = function (stack) {
  var stackLines = stack.split('\n')
  var buckets = {
    'frame': [],
    'lines': []
  }
  _.each(stackLines, function (stackLine) {
    var pattern = /^\s\s\s\sat\s/
    var match = stackLine.match(pattern)
    if (match) {
      buckets.lines.push(stackLine)
    } else {
      buckets.frame.push(stackLine)
    }
  })
  return buckets
}

/** join the stack from with the lines */
evalMarkdown.stackJoin = function (stack) {
  return [
    stack.frame.join('\n'),
    stack.lines.join('\n')
  ].join('\n')
}

/** get the line:char from string */
evalMarkdown.parseLineChar = function (s) {
  if (s instanceof Error && s.message) s = s.message
  var patternLineChar = /:(\d+):(\d+)/
  var patternLine = /:(\d+)/

  var matchLineChar = s.match(patternLineChar)
  var matchLine = s.match(patternLine)
  if (matchLineChar) {
    matchLineChar.lineChar = matchLineChar[0]
    matchLineChar.line = parseInt(matchLineChar[1], 10)
    matchLineChar.char = parseInt(matchLineChar[2], 10)
    return matchLineChar
  } else if (matchLine) {
    matchLine.lineChar = parseInt(matchLine[1], 10)
    matchLine.line = parseInt(matchLine[1], 10)
    matchLine.char = false
    return matchLine
  }
  return false
}

/** acorn error */
evalMarkdown.acornError = function (e, fileName, blocks, uniformPath) {
  if (!e.stack) return e
  var stack = e.stack
  stack = evalMarkdown.stackParts(stack)
  var lineChar = [e.loc.line, ':', e.loc.column].join('')
  var errorBlock = evalMarkdown.findErrorBlock(blocks, e.loc.line)
  var resolvedPath = (uniformPath) ? fileName : path.resolve(fileName)
  var line = ['    at ', resolvedPath, ':', lineChar, ' {block ', errorBlock.id, '}'].join('')
  stack.lines = [line]
  return evalMarkdown.stackJoin(stack)
}

/** eval error */
evalMarkdown.evalError = function (e, fileName, blocks, uniformPath) {
  if (!e.stack) return e
  var baseName = path.basename(fileName)
  var resolvedPath = (uniformPath) ? fileName : path.resolve(fileName)
  var stack = e.stack
  stack = evalMarkdown.stackParts(stack)
  var origStack = stack.lines
  stack.lines = _.chain(stack.lines)
  .filter(function (line) {
    return line.match(baseName)
  })
  .map(function (line) {
    var lineCharObj = evalMarkdown.parseLineChar(line)
    var lineChar = [lineCharObj.line, ':', lineCharObj.char].join('')
    var errorBlock = evalMarkdown.findErrorBlock(blocks, lineCharObj.line)
    return ['    at ', resolvedPath, ':', lineChar, ' {block ', errorBlock.id, '}'].join('')
  })
  .value()
  var pattern = /:\d+$|\d+:\d+$/
  var tempPath = stack.frame[0].replace(pattern, '')
  var tempParsed = path.parse(tempPath)
  var lastDir = _.last(tempParsed.dir.split(path.sep))
  if (lastDir === 'evalmd') {
    var foundBlock = _.find(blocks, {
      'assignFileHash': tempParsed.base
    })
    if (foundBlock) {
      var lineCharObj = evalMarkdown.parseLineChar(stack.frame[0])
      var errorBlock = evalMarkdown.findErrorBlock(blocks, lineCharObj.line)
      stack.frame[0] = [resolvedPath, '>', foundBlock.assignFile, ':', lineCharObj.lineChar, ' {block ', errorBlock.id, '}'].join('')
    }
  }

  if (stack.lines.length) {
    stack.lines = [_.first(stack.lines)]
  } else {
    stack.lines = origStack
  }

  return evalMarkdown.stackJoin(stack)
}

/** send code off to be evaluated  */
evalMarkdown.evaluations = function (blocks, code, fileName, pkg, prependPath, uniformPath, nonstop, blockScope, fileHalt) {
  var evaluations = []
  evaluations.preventEval = false
  evaluations.nojs = false
  var liveBlocks = _.filter(blocks, {'prevent': false})

  if (!blocks.length || !liveBlocks.length) {
    evalMarkdown.logInfo(fileName, ['no blocks'])
    evaluations.nojs = true
    return evaluations
  }
  if (blockScope) {
    var blockHalt = false
    evaluations = _.map(blocks, function (block) {
      if (!block.prevent) {
        var halt = _.contains([fileHalt, blockHalt], true)
        var evaluate = evalMarkdown.evaluate(blocks, block, pkg, prependPath, fileName, uniformPath, halt)
        evaluate.halted = ((evaluate.halt && !nonstop) || (evaluate.error && !nonstop))
        blockHalt = evaluate.halted
        return evaluate
      }
    })
  } else {
    var evaluate = evalMarkdown.evaluate(blocks, code, pkg, prependPath, fileName, uniformPath, fileHalt)
    evaluate.halted = (evaluate.error && !nonstop)
    evaluations.push(evaluate)
  }
  return evaluations
}

/** evaluate code  */
evalMarkdown.evaluate = function (blocks, code, pkg, prependPath, fileName, uniformPath, halt) {
  var block = (typeof code === 'object') ? code : false

  var evaluate = {}
  evaluate.scope = (block) ? 'block' : 'file'
  evaluate.error = false
  evaluate.ran = false
  evaluate.output = false
  evaluate.halt = halt
  if (halt) return evaluate

  if (evaluate.scope === 'block') {
    evalMarkdown.logInfo(fileName, ['running', 'block', block.id].join(' '))
    code = block.asFile
  } else {
    var blockIds = _.chain(blocks).filter({'prevent': false}).map('id').value().join(', ')
    var block$ = (blockIds.length === 1) ? 'block' : 'blocks'
    evalMarkdown.logInfo(fileName, ['running', block$, blockIds].join(' '))
  }

  try {
    code = evalMarkdown.moduleParser(blocks, code, pkg, prependPath)
  } catch (e) {
    var acornStack = evalMarkdown.acornError(e, fileName, blocks, uniformPath)
    evalMarkdown.logError(acornStack)
    evaluate.error = e
    return evaluate
  }
  try {
    evaluate.ran = true
    evaluate.output = _eval(code, fileName, {}, true)
  } catch (e) {
    var evalStack = evalMarkdown.evalError(e, fileName, blocks, uniformPath)
    evalMarkdown.logError(evalStack)
    evaluate.error = e
    return evaluate
  }
  return evaluate
}

/** prepend a string with colored 'evalmd info' */
evalMarkdown.logInfo = function (primary, supplementary) {
  var line = [
    chalk.white('evalmd'),
    chalk.green('info'),
    (supplementary) ? chalk.magenta(primary) : primary,
    supplementary,
    '\n'
  ].join(' ')
  evalMarkdown.log(line, 'info')
  return line
  // process.stderr.write(line)
}

/** prepend error message */
evalMarkdown.prependErr = function (primary, supplementary) {
  return [
    chalk.white('evalmd'),
    chalk.red('ERR!'),
    (supplementary) ? chalk.magenta(primary) : primary,
    supplementary
  ].join(' ')
}

/** log each line of error.stack prepended */
evalMarkdown.logErrorMessage = function () {
  var args = _.values(arguments)
  var line = evalMarkdown.prependErr.apply(null, args) + '\n'
  evalMarkdown.log(line, 'err')
  return line
  // return process.stderr.write(line)
}

evalMarkdown.cleanStack = function (errOrStack) {
  if (errOrStack.stack) return errOrStack.stack.split('\n')
  if (Array.isArray(errOrStack)) return errOrStack
  if (errOrStack) return errOrStack.split('\n')
  return false
}

/** log each line of error.stack prepended */
evalMarkdown.logError = function (error) {
  var lines = evalMarkdown.cleanStack(error)
  return _.each(lines, function (line) {
    return evalMarkdown.logErrorMessage(line)
  })
}

module.exports = evalMarkdown

// /** get the content of each file */
// testMarkdown.mdContent = function (dataSets) {
//   return Promise.map(dataSets, function (dataSet) {
//     return fs.readFileAsync(dataSet.fileName, 'utf8').then(function (mdContent) {
//       dataSet.mdContent = mdContent
//       dataSet.mdContentMatchable = mdContent
//       .replace(/```\n/g, '\n// TERMINATEDCODEBLOCK\n```\n') // https://github.com/chjj/marked/issues/645
//       .replace(/ {4}/g, '\t') // https://github.com/chjj/marked/issues/644
//       return dataSet
//     })
//   })
// }
//
// /** render the HTML of the markdown document */
// testMarkdown.htmlContent = function (dataSets) {
//   return Promise.map(dataSets, function (dataSet) {
//     return markedAsync(dataSet.mdContentMatchable).then(function (htmlContent) {
//       dataSet.htmlContent = htmlContent
//       return dataSet
//     })
//   })
// }
//
// /** pull the javascript code blocks out of the HTML */
// testMarkdown.parseHtml = function (dataSets, pkg, prepend) {
//   return _.map(dataSets, function (dataSet) {
//     var $ = cheerio.load(dataSet.htmlContent, {
//       decodeEntities: true,
//       normalizeWhitespace: false
//     })
//     var code = $('code.lang-javascript, code.lang-js')
//     dataSet.blocks = code.map(function (i, elm) {
//       var block = {}
//       var $this = $(this)
//       var target = $this.parent().prev().children().eq(0)
//       block.prevSiblingTag = target[0] ? target[0].name : undefined
//       block.prevSiblingHref = target.attr('href')
//       block.prevSiblingContent = target.text()
//       block.parentTag = this.name
//       block.parentClass = $this.attr('class')
//       block.code = $this.html()
//       return block
//     })
//     .get()
//     console.log(dataSet.blocks)
//     return dataSet
//   })
// }

/** creates a has from string */
// testMarkdown.hashBlock = function (block) {
//   var shasum = crypto.createHash('sha256')
//   return shasum.update(block).digest('hex')
// }

/** replaces the string in palce */
// testMarkdown.replacePosition = function (str, start, end, value) {
//   return str.substr(0, start) + value + str.substr(end)
// }
//
// testMarkdown.moduleSelfRequire = function (dataSets, deps) {
//   return _.map(dataSets, function (dataSet) {
//
//     var fileDeclorations = _.chain(dataSet.fileBlocks)
//     .map('prevSiblingHref')
//     .filter(function (prevSiblingHref) {
//       if (prevSiblingHref && prevSiblingHref.match(/file eval/i)) return true
//       if (prevSiblingHref && prevSiblingHref.match(/fileeval/i)) return true
//       return false
//     })
//     .value()
//
//     if (fileDeclorations) {
//       dataSet.fileBlocks = _.map(dataSets.fileBlocks, function (block) {
//         // todo: wrap try / catch
//         var ast = acorn.parse(block.code, {ecmaVersion: 6})
//         var deps = umd(ast, {
//           es6: true, amd: true, cjs: true
//         })
//
//         var chars = 0
//         var localRegex = /^.\.\/|^.\/|^\//
//         _.each(deps, function (dep) {
//           if (dep.source.value && _.contains(fileDeclorations, dep.source.value)) {
//
//             // 'var _eval = require(\'eval\'); var '+DEPNAME+' = _eval(\''+source+'\');'
//
//             // var start = charsAddedPrepend + dep.source.start + 1
//             // var end = charsAddedPrepend + dep.source.end - 1
//             // var newRef = path.join(prepend, dep.source.value)
//             // if (!newRef.match(/^\/|\.+\//)) newRef = './' + newRef
//             // code = testMarkdown.replacePosition(code, start, end, newRef)
//             // charsAddedPrepend += Math.abs(newRef.length - dep.source.value.length)
//           }
//         })
//
//       })
//     }
//
//     return dataSet
//   })
// }
//

/*
previousTag: 'a' || 'code'
previousTagHref: 'prevent eval' || 'preventEval' || 'eval prevent'
previousTagHref: 'eval shim ./calico.js',
previousTagHref: 'evalShim ./calico.js',
previousTagHref: 'shimEval ./calico.js',
shimName: './calico.js'
 */

// var source = _.find(dataSet.blocks, {
//   'shimName': dep.source.value
// })
//
// source.replace('\n', ';')
//
// 'var _eval = require(\'eval\'); var '+DEPNAME+' = _eval(\''+source+'\');'

/** parse the require / import calls and edit them */
// testMarkdown.moduleParser = function (code, pkg, prepend) {
//   prepend = prepend || './'
//   var ast = acorn.parse(code, {ecmaVersion: 6})
//   var deps = umd(ast, {
//     es6: true, amd: true, cjs: true
//   })
//   var charsAddedModuleName = 0
//   // change package if required
//   _.each(deps, function (dep) {
//     if (pkg && pkg.main && dep.source.value === pkg.name) {
//       var start = charsAddedModuleName + dep.source.start + 1
//       var end = charsAddedModuleName + dep.source.end - 1
//       var main = path.join(prepend, pkg.main)
//       if (!main.match(/^\/|\.+\//)) main = './' + main
//       code = testMarkdown.replacePosition(code, start, end, main)
//       charsAddedModuleName += Math.abs(pkg.main.length - dep.source.value.length)
//     }
//   })
//   var charsAddedPrepend = 0
//   // prefix local modules with dir
//   if (prepend) {
//     var localRegex = /^.\.\/|^.\/|^\//
//     _.each(deps, function (dep) {
//       if (dep.source.value && dep.source.value.match(localRegex)) {
//         var start = charsAddedPrepend + dep.source.start + 1
//         var end = charsAddedPrepend + dep.source.end - 1
//         var newRef = path.join(prepend, dep.source.value)
//         if (!newRef.match(/^\/|\.+\//)) newRef = './' + newRef
//         code = testMarkdown.replacePosition(code, start, end, newRef)
//         charsAddedPrepend += Math.abs(newRef.length - dep.source.value.length)
//       }
//     })
//   }
//   return code
// }

//
// /** assemble the javascrpt blocks */
// testMarkdown.assembleBlocks = function (dataSets) {
//   return _.map(dataSets, function (dataSet) {
//     dataSet.mdContentLines = S.lines(dataSet.mdContent)
//     dataSet.blockCounter = {}
//     dataSet.blocks = _.map(dataSet.blocks, function (block, id) {
//       var prevent = [
//         block.prevSiblingHref && block.prevSiblingHref.match(/prevent eval/i),
//         block.prevSiblingHref && block.prevSiblingHref.match(/preventeval/i),
//         Boolean(block.code.match(/^\/\/ prevent eval/i)),
//         Boolean(block.code.match(/^\/\/ preventeval/i))
//       ]
//
//       block.codeLines = S.lines(block.code)
//
//       block.blockSyntaxTypes = {
//         'lang-javascript': '```javascript',
//         'lang-js': '```js'
//       }
//
//       block.codeMatchable = S.unescapeHTML(block.code)
//       block.codeMatchable = block.codeMatchable
//       .replace(/ {4}/g, '\t')
//       .replace(/\n\/\/ TERMINATEDCODEBLOCK\n$/, '')
//       .replace(/\r\n/, '\n')
//       .replace(/\r/, '\n')
//
//       block.codeEvalable = S.unescapeHTML(block.code)
//       .replace(/\n\/\/ TERMINATEDCODEBLOCK\n$/, '')
//
//       block.codeEvalableLines = S.lines(block.codeEvalable)
//
//       block.blockSyntax = block.blockSyntaxTypes[block.parentClass]
//       block.codeMatchable = [block.blockSyntax, '\n', block.codeMatchable, '```'].join('')
//       block.hash = testMarkdown.hashBlock(block.codeMatchable)
//       block.multiIndexOf = testMarkdown.multiIndexOf(dataSet.mdContent, block.codeMatchable)
//       if (typeof dataSet.blockCounter[block.hash] === 'undefined') {
//         dataSet.blockCounter[block.hash] = 0
//       } else {
//         dataSet.blockCounter[block.hash]++
//       }
//       block.startChar = block.multiIndexOf[dataSet.blockCounter[block.hash]]
//       block.startLine = testMarkdown.getLineNumber(dataSet.mdContent, block.startChar)
//       block.endLine = block.startLine + block.codeEvalableLines.length
//       block.pullCode = _.slice(dataSet.mdContentLines, block.startLine, block.endLine)
//
//       block.pullCodeLastLine = _.last(block.pullCode)
//       if (block.pullCodeLastLine.match(/```$/)) {
//         block.pullCode.pop()
//         block.pullCodeLastLine = block.pullCodeLastLine.replace(/```$/, '')
//         block.pullCode.push(block.pullCodeLastLine)
//       }
//       block.pullCode = block.pullCode.join('\n')
//
//       block.prevent = _.contains(prevent, true)
//       block.id = id + 1
//       return block
//     })
//     return dataSet
//   })
// }
//
// /** replace items in array stating with index */
// testMarkdown.replaceItems = function (start, main, sub) {
//   main = (Array.isArray(main)) ? main : main.split('\n')
//   sub = (Array.isArray(sub)) ? sub : sub.split('\n')
//   var output = _.flatten([_.slice(main, 0, start), sub, _.slice(main, start + sub.length, main.length)])
//   return output
// }
//
// /** assemble the javascrpt document */
// testMarkdown.assembleJs = function (dataSets) {
//   return _.map(dataSets, function (dataSet) {
//     var lines = dataSet.mdContent.split('\n').length
//     var emptyDoc = _.range(lines).map(function () {
//       return ''
//     })
//     _.each(dataSet.blocks, function (block) {
//       if (!block.prevent && block.startLine) {
//         emptyDoc = testMarkdown.replaceItems(block.startLine, emptyDoc, block.pullCode)
//       }
//     })
//     if (emptyDoc.length !== lines) {
//       // var parsedName = path.parse(dataSet.fileName)
//       // var jsFile = parsedName.dir + parsedName.name + '.js'
//       // fs.writeFileSync(jsFile, emptyDoc.join('\n'))
//       throw new Error('internal error incorrect doc assembly contact maintainer directly <thomas@reggi.com>')
//     }
//     dataSet.assembleJs = emptyDoc.join('\n')
//     return dataSet
//   })
// }

/** assemble each block as a file */
// testMarkdown.assembleBlocksAsFiles = function (dataSets) {
//   return _.map(dataSets, function (dataSet) {
//     var lines = dataSet.mdContent.split('\n').length
//     var emptyDoc = _.range(lines).map(function () {
//       return ''
//     })
//     dataSet.fileBlocks = _.map(dataSet.blocks, function (block) {
//       if (!block.prevent && block.startLine) {
//         return testMarkdown.replaceItems(block.startLine, emptyDoc, block.pullCode)
//       }
//     })
//     return dataSet
//   })
// }
//
//
// /** acorn error */
// testMarkdown.acornError = function (e, dataSet) {
//   var stack = e.stack
//   var lineChar = [e.loc.line, ':', e.loc.column].join('')
//   var errorBlock = testMarkdown.findErrorBlock(dataSet.blocks, e.loc.line)
//   var resolvedPath = path.resolve(dataSet.fileName)
//   var line = ['    at ', resolvedPath, ':', lineChar, ' {block ', errorBlock.id, '}'].join('')
//   stack = defaultStack.unshiftLines(stack, line)
//   return stack
// }
//
// /** eval error */
// testMarkdown.evalError = function (e, dataSet) {
//   var fileName = path.basename(dataSet.fileName)
//   var resolvedPath = path.resolve(dataSet.fileName)
//   var stack = e.stack
//   stack = defaultStack.stackParts(stack)
//   stack.lines = _.chain(stack.lines).map(function (line) {
//     var match = line.match(fileName)
//     if (match) {
//       var lineCharObj = defaultStack.parseLineChar(line)
//       var lineChar = [lineCharObj.line, ':', lineCharObj.char].join('')
//       var errorBlock = testMarkdown.findErrorBlock(dataSet.blocks, lineCharObj.line)
//       return ['    at ', resolvedPath, ':', lineChar, ' {block ', errorBlock.id, '}'].join('')
//     }
//     return line
//   })
//   .value()
//   // .filter(function (line) {
//   //   return line.match(fileName)
//   // })
//   return defaultStack.stackJoin(stack)
// }
//
//
// /** get the stack with the file lines */
// testMarkdown.stackTrace = function (stack) {
//   var stackLines = stack.split('\n')
//   return _.chain(stackLines)
//   .filter(function (stackLine) {
//     var match = /^\s\s\s\sat\s/
//     return stackLine.match(match)
//   })
//   .value()
// }
//
// /** get the stack without the file lines */
// testMarkdown.stackFrame = function (stack) {
//   var stackLines = stack.split('\n')
//   return _.chain(stackLines)
//   .filter(function (stackLine) {
//     var match = /^\s\s\s\sat\s/
//     return !stackLine.match(match)
//   })
//   .value()
// }
//
// /** get the line:char from string */
// testMarkdown.parseLineChar = function (s) {
//   if (s.message) s = s.message
//   var pattern = /(\d+):(\d+)/
//   var match = s.match(pattern)
//   if (match) {
//     match.lineChar = match[0]
//     match.line = parseInt(match[1], 10)
//     match.char = parseInt(match[2], 10)
//   }
//   return false
// }
//
// /** standardize the stack str, stack arr,  err obj */
// testMarkdown.cleanStack = function (errOrStack) {
//   if (errOrStack.stack) return errOrStack.stack.split('\n')
//   if (Array.isArray(errOrStack)) return errOrStack
//   if (errOrStack) return errOrStack.split('\n')
//   return false
// }
//
// /** get all the stack 'at' lines that are .md */
// testMarkdown.markdownStackTrace = function (errOrStack) {
//   var lines = testMarkdown.cleanStack(errOrStack)
//   return _.filter(lines, function (line) {
//     var possiblePaths = _.without(line.split(' '), '')
//     var mdPaths = _.map(possiblePaths, function (possiblePath) {
//       possiblePath = possiblePath
//       .replace(/\s+/, '')
//       .replace(/^\(/, '')
//       .replace(/\)$/, '')
//       .replace(/:\d+:\d+$/, '')
//       return path.extname(possiblePath)
//     })
//     return _.contains(mdPaths, '.md') || _.contains(mdPaths, '.markdown')
//   })
// }
//

// var hashes = _.map(dataSet.jsContent, 'hash')
// var lines = doc.split('\n')
//
// lines = _.chain(lines)
// .map(function (line) {
//   var hash = _.find(hashes, function (hash) { return line.match(hash) })
//   if (hash) return hash
//   return ''
// })
// .map(function (line) {
//   var blockMatch = _.find(dataSet.jsContent, {
//     'hash': line
//   })
//   if (blockMatch) {
//     var blockLines = blockMatch.code.split('\n')
//     if (blockMatch.prevent) {
//       blockLines = _.map(blockLines, function (blockLines) {
//         return ''
//       })
//     }
//     return blockLines
//   }
//   return line
// })
// .flatten()
// .value()
// dataSet.evalFile = lines.join('\n')

// console.log(dataSet.jsContent)
//
// dataSet.error = false
// dataSet.evaluated = false
// dataSet.output = false
// if (errorOccured && !nonstop) return dataSet

// var code = _.map(dataSet.jsContent, 'code').join('\n')
// var ids = _.map(dataSet.jsContent, 'id').join(', ')
// var block$ = (ids.length) ? 'block' : 'blocks'
// testMarkdown.logInfo(dataSet.fileName, ['running', block$, ids].join(', '))
// try {
//   dataSet.evaluated = true
//   dataSet.output = _eval(code, dataSet.fileName, {}, true)
// } catch (e) {
//   dataSet.error = e
//   errorOccured = true
//   testMarkdown.logErr(e)
// }
// console.log(dataSet)
// return dataSet
// //
// textMarkdown.expandHash = function (lines, jsContent) {
//   return _.map(lines, function (line) {
//     var assemble = _.chain(hashes)
//     .map(function(hash) {
//       var assemble = false
//       var match = line.match(hash)
//       var hashLength = hash.length
//       if (match) {
//         assemble = []
//         if (match.index === 0) {
//           assemble.push({'hash': hash})
//           assemble.push(line.substr(hashLength))
//         } else {
//           assemble.push(line.substr(0, match.index))
//           assemble.push({'hash': hash})
//           assemble.push(line.substr(match.index + hashLength))
//         }
//       }
//       return assemble
//     }).without(false).value()[0] || false
//     if (assemble) {
//       var
//       return assembled _.map(assemble, function (piece) {
//         if (typeof piece === 'string') return piece
//
//         var blockMatch = _.find(dataSet.jsContent, {
//           'hash': piece.hash
//         })
//         if (blockMatch) {
//           var blockLines = blockMatch.code.split('\n')
//           if (blockMatch.prevent) {
//             blockLines = _.map(blockLines, function (blockLines) {
//               return ''
//             })
//           }
//           return blockLines
//         }
//         return line
//
//       })
//     }
//     return ''
//   })
// }

// /** create a hash of the javascript block */
// testMarkdown.hashBlock = function (block) {
//   var shasum = crypto.createHash('sha256')
//   return shasum.update(block).digest('hex')
// }

// /** replace code blocks with hashes  */
// testMarkdown.mdEmbededHashes = function (dataSets) {
//   return _.map(dataSets, function (dataSet) {
//     dataSet.jsContent = _.map(dataSet.jsContent, function (block) {
//
//       return block
//     })
//   })
// }

// var blockLines = block.split('\n')
// if (_.last(blockLines) === '') blockLines.pop()
// if (_.last(blockLines) === '// TERMINATEDCODEBLOCK') blockLines.pop()
// if (_.last(blockLines) === '') blockLines.pop()
// block = blockLines.join('\n')
//
// var preventFlags = [
//   sibHtml === '<a href="#prevent eval"></a>',
//   sibHtml === '<a href="#preventeval"></a>',
//   Boolean(block.match(/^\/\/ prevent eval/)),
//   Boolean(block.match(/^\/\/ preventeval/))
// ]
//

// report.rawCode = entities.decode(block)
// // report.refCode = report.rawCode.replace(/ {4}/g, '\t')
// report.refCode = report.rawCode
// report.parsedCode = testMarkdown.moduleParser(report.rawCode, pkg, prepend)
// report.lines = report.parsedCode.split('\n').length
// report.startChar = dataSet.mdContentRef.indexOf(report.refCode)
// report.endChar = report.startChar + report.refCode.length
// report.startLine = getLineNumber(dataSet.mdContentRef, report.refCode)
// report.endLine = report.startLine + report.lines
// console.log(report)
// dataSet.jsContent.push(report)

// if (block.matches > 1) {
//
//   var match = _.find(dataSet.contentAddressCounts, {
//     'content': block.codeMatchable
//   })
//
//   var count = (match) ? match.count : 0
//   console.log(block.multiIndexOf)
//   block.startChar = block.multiIndexOf[count]
//   console.log(count)
//   if (!match) {
//     var match = {
//       'content': block.codeMatchable,
//       'count': count + 1
//     }
//     dataSet.contentAddressCounts.push(match)
//   }else {
//     match.count = match.count + 1
//   }
//   // console.log(match)
// } else {
//   block.startChar = dataSet.mdContent.indexOf(block.codeMatchable)
// }

// console.log(JSON.stringify(block.codeMatchable))
// block.matches = S.count(dataSet.mdContent, block.codeMatchable)
// block.progress
// block.check = dataSet.mdContent.indexOf(block.codeMatchable)
// pretty(block.startChar)
// pretty(block.codeMatchable)
// block.startChar = dataSet.mdContent.indexOf(block.codeMatchable)
// if (!block.matches) {
//   console.log(JSON.stringify(block.codeMatchable))
// }
// console.log(block)
// block.startLine = getLineNumber(dataSet.mdContentLines, block.startChar)
// if (block.codeLines.length !== block.unescapeCodeLines.length) throw new Error('big problem')
// console.log(block)
//

// /** find block with given line */
// testMarkdown.findErrorBlock = function (items, line) {
//   return _.find(items, function (item) {
//     return item.startLine <= line && item.endLine >= line
//   })
// }
//
// /** pull the javascript code blocks out of the HTML */
// testMarkdown.jsEval = function (dataSets, nonstop) {
//   var errorOccured = false
//   return _.map(dataSets, function (dataSet) {
//     // console.log(errorOccured)
//     dataSet.error = false
//     dataSet.evaluated = false
//     dataSet.output = false
//     if (errorOccured && !nonstop) return dataSet
//
//     var code = dataSet.assembledCode
//
//     var ids = _.map(dataSet.jsContent, 'id').join(', ')
//     var block$ = (ids.length === 1) ? 'block' : 'blocks'
//     testMarkdown.logInfo(dataSet.fileName, ['running', block$, ids].join(' '))
//     try {
//       dataSet.evaluated = true
//       dataSet.output = _eval(code, dataSet.fileName, {}, true)
//     } catch (e) {
//       dataSet.error = e
//       errorOccured = true
//       var errorLine = testMarkdown.errorLine(e.stack)
//       var errorBlock = testMarkdown.findErrorBlock(dataSet.jsContent, errorLine)
//       testMarkdown.logErr('block ' + errorBlock.id)
//       testMarkdown.logErr(e)
//     }
//     return dataSet
//   })
// }

// console.log(dataSet.mdContentLines.length)
// console.log(dataSet.mdContentRefLines.length)
// if (dataSet.mdContentLines.length !== dataSet.mdContentRefLines.length) throw new Error('big problem')

// dataSet.mdContentLines = S.lines(dataSet.mdContent)
// dataSet.mdContentRefLines = S.lines(dataSet.mdContentRef)

// .then(function (dataSets) {
//   return testMarkdown.parseHtml(dataSets, pkg, prepend)
// })
//
// .then(function (dataSets) {
//   return testMarkdown.jsEval(dataSets, nonstop)
// })

// /**
//  *
//  * How do you strip everything out of a markdown file except for ```js and ```javascript code blocks?
//  *
//  */
// testMarkdown.blockLines = function (dataSets) {
//   return _.map(dataSets, function (dataSet) {
//
//   })
// }

// testMarkdown.betterMatch = function (content, pattern) {
//   var exp = new RegExp(pattern, 'g')
//   var match = content.match(exp)
//   if (!match) return []
//   // console.log(match)
//   return match
// }

// /**
//  * shift over arr^obj^arr
//  * @see http://stackoverflow.com/q/32027313/340688
//  */
// testMarkdown.mapShiftOver = function (data, idProp, contentProp, shiftProp) {
//   var master = _.chain(data).indexBy(idProp).values().value()
//   return _.map(data, function (item) {
//     var temp = {}
//     temp[idProp] = item[idProp]
//     var masterItem = _.find(master, temp)
//     console.log(masterItem)
//     if (!masterItem || !masterItem[contentProp]) return undefined
//     item[shiftProp] = masterItem[contentProp].shift()
//     return item
//   })
// }

// var name = (errOrStack.name) ? errOrStack.name : 'Error'
// var betterStack = []
// var callout = testMarkdown.stackTrace(stack)
// var firstLine = callout.shift()
// callout.unshift('Unhandled rejection ' + firstLine)
// betterStack = betterStack.concat(callout)
// var markdownStack = testMarkdown.markdownStackTrace(errOrStack)
// betterStack = betterStack.concat(markdownStack)
// betterStack = betterStack.join('\n')

// if (e.loc.line) {
//
// }
// throw testMarkdown.formatError(e)
// var errorLine = testMarkdown.errorLine(e.stack)
// var errorBlock = testMarkdown.findErrorBlock(dataSet.blocks, errorLine)
// if (errorBlock) testMarkdown.logErr('block ' + errorBlock.id)
// testMarkdown.logErr(e)

// console.log($($(this).parent().html()))

// var $parent = $($(this).parent().html())
// var $prevSibling = $($(this).parents().prev())
// var block = {}
// block.parentClass = $parent.attr('class')
// block.prevSibling = $prevSibling.html()
// block.code = $(this).html()
// // console.log(block)
// dataSet.blocks.push(block)

/*
previousTag: 'a' || 'code'
previousTagHref: 'prevent eval' || 'preventEval' || 'eval prevent'
previousTagHref: 'eval shim ./calico.js',
previousTagHref: 'evalShim ./calico.js',
previousTagHref: 'shimEval ./calico.js',
shimName: './calico.js'
 */

// var source = _.find(dataSet.blocks, {
//   'shimName': dep.source.value
// })
//
// source.replace('\n', ';')
//
// 'var _eval = require(\'eval\'); var '+DEPNAME+' = _eval(\''+source+'\');'

// function pretty (obj) {
//   console.log(JSON.stringify(obj, null, 2))
// }
// pretty('hi')

/** evaluates a dir of md files or a single file */
// function testMarkdown (file$, prepend, nonstop) {
//   var files = _.flatten([file$])
//   var dataSets = testMarkdown.arrToObjWithProp(files, 'fileName')
//   testMarkdown.logInfo('it worked if it ends with', 'ok')
//   return fs.readFileAsync('./package.json')
//   .then(JSON.parse)
//   .catch(function () { return false })
//   .then(function (pkg) {
//     return Promise.resolve(dataSets)
//     .then(testMarkdown.mdContent)
//     .then(testMarkdown.htmlContent)
//     .then(testMarkdown.parseHtml)
//     .then(testMarkdown.assembleBlocks)
//     .then(testMarkdown.assembleJs)
//     .then(testMarkdown.assembleBlocksAsFiles)
//     .then(_.partialRight(testMarkdown.jsEval, nonstop, pkg, prepend))
//     .then(function (dataSets) {
//       // _.each(dataSets, function (dataSet) {
//       //   _.each(dataSet.blocks, function (block) {
//       //     console.log(block.startLine)
//       //   })
//       // })
//       // pretty(dataSets)
//       testMarkdown.logInfo('ok')
//       return dataSets
//     })
//   })
// }

// /** convert array to array of objects with set propety */
// evalMarkdown.arrToObjWithProp = function (arr, prop) {
//   return _.map(arr, function (item) {
//     var tmp = {}
//     tmp[prop] = item
//     return tmp
//   })
// }
