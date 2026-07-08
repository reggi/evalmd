var osTmpDir = require('os-tmpdir')
var crypto = require('crypto')
var path = require('path')
var child_process = require('child_process')
var { flatten, groupBy, range, values } = require('lodash')
var promisify = require('util.promisify')
var fsExtra = require('fs-extra')
var MarkdownIt = require('markdown-it')
var acorn = require('acorn')
var umd = require('./acorn-umd/acorn-umd').default
var promiseRipple = require('./promise-ripple')
var promiseSeries = require('./promise-series')
// var _eval = require('eval')
var chalk = require('chalk')
var isCore = require('is-core-module')
var temp = path.join(osTmpDir(), 'evalmd')

var fs = {
  readFileAsync: promisify(fsExtra.readFile),
  mkdirsAsync: promisify(fsExtra.mkdirs),
  writeFileAsync: promisify(fsExtra.writeFile),
  unlinkAsync: promisify(fsExtra.unlink)
}

var log = false
var DEBUG = false

/**
 * :fishing_pole_and_fish: Evaluates javascript code blocks from markdown files.
 * @module evalmd
 * @package.keywords eval, evaulate, javascript, markdown, test
 * @package.preferGlobal
 * @package.bin.evalmd ./bin/eval-markdown.js
 * @package.bin.test-markdown ./bin/eval-markdown.js
 * @package.bin.eval-markdown ./bin/eval-markdown.js
 */

function main (filePath$, packagePath, prepend, blockScope, nonstop, preventEval, includePrevented, silence, debug, output, delimeter) {
  var logStore = []
  DEBUG = debug
  log = logFactory(logStore, silence)
  var filePaths = flatten([filePath$])
  logInfo('it worked if it ends with', 'ok')
  return getPackage(packagePath)
  .then(function (pkg) {
    return Promise.all(filePaths.map(function (filePath) {
      return assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter)
    }))
  })
  .then(function (mdResults) {
    // console.log(mdResults)
    var exitCode = getExitCode(mdResults)
    if (exitCode === 0) logInfo('ok')
    logDebug('exit code', exitCode)
    return {
      dataSets: mdResults,
      exitCode: exitCode,
      log: logStore
    }
  })
  .catch(function (error) {
    logErr(error)
    var exitCode = 1
    logDebug('exit code', exitCode)
    return {
      dataSets: null,
      exitCode: 1,
      log: null
    }
  })
}

function getExitCode(mdResults) {
  var evaluations = flatten(mdResults.map(function (mdResult) { return mdResult.evaluated }))
  var evalResults = flatten(evaluations.map(function (evaluation) { return evaluation.evalResult }))
  var evalResultsInstanceofError = evalResults.map(function (evalResult) {
    return evalResult instanceof Error
  })
  var evalResultsHasInstanceofError = evalResultsInstanceofError.indexOf(true) !== -1
  if (evalResultsHasInstanceofError) return 1
  return 0
}

function getPackage(packagePath) {
  packagePath = (packagePath) ? packagePath : './package.json'
  return fs.readFileAsync(packagePath, 'utf8')
  .then(JSON.parse)
  .then(function (pkg) {
    pkg.path = packagePath
    return pkg
  })
  .catch(function () { return false })
}

function previousIndex(node, nodes, fn) {
  var index = nodes.indexOf(node)
  index = index < 0 ? 0 : index
  var subArr = nodes.slice(0, index)
  var revIndex = subArr.reverse().findIndex(fn)
  if (revIndex < 0) return 0
  return subArr.length - revIndex
}

function previousIndexType(node, nodes, type) {
  return previousIndex(node, nodes, function (node) {
    return node.type === type
  })
}

function previousIndexClose(node, nodes, type) {
  return previousIndex(node, nodes, function (node) {
    return node.type.match(/\_close$/)
  })
}

function groupChildren(nodes) {
  nodes = groupBy(nodes, function (node) {
    return previousIndexClose(node, nodes)
  })
  return values(nodes)
}

/** searches preceeding nodes for pattern */
function searchLink(subNodes, pattern) {
  var textNode = subNodes.find(function (node) {
    if (!node.content) return false
    return node.content.match(pattern)
  })
  if (textNode) {
    var match = textNode.content.match(pattern)
    if (match && match[1]) return match[1]
    if (match) return true
  } else {
    return false
  }
}

function searchComment(node, pattern) {
  var commentMatch = node.content.match(pattern)
  // if there's a first-line comment match return the value
  if (commentMatch && commentMatch[2]) {
    return commentMatch[2]
  } else if (commentMatch) {
    return true
  } else {
    return false
  }
}

function createLineDoc(lines) {
  return range(lines).map(function () {
    return ''
  })
}

function replaceLines(start, main, sub) {
  main = (Array.isArray(main)) ? main : main.split('\n')
  sub = (Array.isArray(sub)) ? sub : sub.split('\n')
  var output = flatten([main.slice(0, start), sub, main.slice(start + sub.length, main.length)])
  return output
}

function getHash(content) {
  var shasum = crypto.createHash('md5')
  return shasum.update(content).digest('hex')
}

function mapNodes(nodes) {
  return nodes.map(function (node, index) {
    node.children = groupChildren(node.children)
    node.previousFenceIndex = previousIndexType(node, nodes, 'fence')

    var subNodes = nodes.slice(node.previousFenceIndex, index)

    node.fileEval = searchLink(subNodes, /\[(.+)?\]\(#?(eval\s?file|file\s?eval)\)/i) ||
      searchComment(node, /\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i) ||
      false

    node.preventEval = Boolean(searchLink(subNodes, /\[(.+)?\]\(#?(eval\s?prevent|prevent\s?eval)\)/i)) ||
      Boolean(searchComment(node, /\/\/\s(prevent\s?eval\s|eval\s?prevent\s)(.+)/i)) ||
      false

    node.startLine = (node.map) ? node.map[0] + 1 : false
    node.endLine = (node.map) ? node.map[1] - 1 : false

    return node
  })
}

function getNodeId(nodes, filePath) {
  return nodes.map(function (node, index) {
    node.id = index + 1
    return node
  })
}

function getFences(nodes, langs) {
  return nodes.filter(function (node) {
    if (node.type !== 'fence') return false
    if (!langs && node.type === 'fence') return true
    // commonmark trims the info string and takes its first word as the language
    var lang = String(node.info || '').trim().split(/\s+/)[0]
    return langs.indexOf(lang) !== -1
  })
}

function filterPrevented(nodes) {
  return nodes.filter(function (node) {
    return !node.preventEval
  })
}

function buildPreserveLines(node$, lines) {
  var nodes = flatten([node$])
  var lineDoc = createLineDoc(lines)
  nodes.forEach(function (node) {
    var contentLines = String(node.content || '').split(/\r\n?|\n/)
    lineDoc = replaceLines(node.startLine, lineDoc, contentLines)
  })
  return lineDoc.join('\n')
}

function buildConcat(node$, lines) {
  var nodes = flatten([node$])
  return nodes
  .map(function (node) {
    return node.content
  })
  .join('')
}

function getDeps(code) {
  var ast = acorn.parse(code, {sourceType: 'module', ecmaVersion: 6})
  var deps = umd(ast, {
    es6: true, amd: true, cjs: true
  })
  return Array.from(new Set(deps))
}

function replacePosition(str, start, end, value) {
  return str.substr(0, start) + value + str.substr(end)
}

function regExpEscape(s) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
}

function alterAssignedModule(code, prepend, pkg) {
  if (!pkg) return code
  prepend = (prepend) ? prepend : './'
  var deps = getDeps(code)
  if (!deps.length) return code
  var name = pkg.name
  var chars = 0
  name = regExpEscape(name)
  var pattern = new RegExp('^' + name + '($|/.*)')
  deps.forEach(function (dep) {
    var match = dep.source.value.match(pattern)
    if (match) {
      var start = chars + dep.source.start + 1
      var end = chars + dep.source.end - 1
      var absModule = path.dirname(path.resolve(pkg.path))
      var replacement = (match[1]) ? path.join(absModule, match[1]) : absModule
      code = replacePosition(code, start, end, replacement)
      chars += Math.abs(replacement.length - dep.source.value.length)
    }
  })
  return code
}

function alterSelfModules(code, nodes) {
  var deps = getDeps(code)
  if (!deps.length) return code
  var chars = 0
  deps.forEach(function (dep) {
    if (dep.source.value) {
      var node = nodes.find(function (node) {
        return node.fileEval === dep.source.value
      })
      if (node && node.fileCreated) {
        var start = chars + dep.source.start + 1
        var end = chars + dep.source.end - 1
        var replacement = node.fileEvalHashPath
        code = replacePosition(code, start, end, replacement)
        chars += Math.abs(replacement.length - dep.source.value.length)
      }
    }
  })
  return code
}

function alterPrependModules(code, nodes, prepend) {
  var deps = getDeps(code)
  if (!deps.length) return code
  prepend = (prepend) ? prepend : './'
  var localRegex = /^.\.\/|^.\//
  var chars = 0
  deps.forEach(function (dep) {
    if (dep.source.value && dep.source.value.match(localRegex)) {
      var node = nodes.find(function (node) {
        return node.fileEval === dep.source.value
      })
      if (!node) {
        var start = chars + dep.source.start + 1
        var end = chars + dep.source.end - 1
        var replacement = path.resolve(path.join(prepend, dep.source.value))
        code = replacePosition(code, start, end, replacement)
        chars += Math.abs(replacement.length - dep.source.value.length)
      }
    }
  })
  return code
}

function alterNpmModules(code, nodes, prepend) {
  var deps = getDeps(code)
  if (!deps.length) return code
  prepend = (prepend) ? prepend : './'
  var nonNpm = /^.\.\/|^.\/|^\//
  var chars = 0
  deps.forEach(function (dep) {
    if (dep.source.value && !dep.source.value.match(nonNpm) && !isCore(dep.source.value)) {
      var start = chars + dep.source.start + 1
      var end = chars + dep.source.end - 1
      var replacement = path.resolve(path.join(prepend, 'node_modules', dep.source.value))
      code = replacePosition(code, start, end, replacement)
      chars += Math.abs(replacement.length - dep.source.value.length)
    }
  })
  return code
}

function alterModules(code, nodes, pkg, prepend) {
  // syntax errors will come through to here and
  // get thrown by the acorn parser
  code = alterAssignedModule(code, prepend, pkg)
  code = alterSelfModules(code, nodes)
  code = alterPrependModules(code, nodes, prepend)
  code = alterNpmModules(code, nodes, prepend)
  return code
}

function buildEvalable(node, nodes, markdownLinesLength, pkg, prepend) {
  var build = {}
  build.preserve = buildPreserveLines(node, markdownLinesLength)
  build.concat = buildConcat(node)
  // if there is an error have preserve run first to return line number
  build.preserveAlter = alterModules(build.preserve, nodes, pkg, prepend)
  build.concatAlter = alterModules(build.concat, nodes, pkg, prepend)
  return build
}

function stackSplit(stack) {
  var stackLines = stack.split('\n')
  var buckets = {
    'frame': [],
    'lines': []
  }
  stackLines.forEach(function (stackLine) {
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
function stackJoin(stack) {
  return [
    stack.frame.join('\n'),
    stack.lines.join('\n')
  ].join('\n')
}

function findErrorNode(nodes, line) {
  return nodes.find(function (node) {
    return node.startLine <= line && node.endLine >= line
  })
}

function errMsg() {
  var args = Array.prototype.slice.call(arguments)
  if (args.length > 1) args[0] = chalk.magenta(args[0])
  return [
    chalk.white('evalmd'),
    chalk.red('ERR!')
  ].concat(args).join(' ')
}

function infoMsg() {
  var args = Array.prototype.slice.call(arguments)
  args[0] = chalk.magenta(args[0])
  return [
    chalk.white('evalmd'),
    chalk.green('info')
  ].concat(args).join(' ')
}

function debugMsg() {
  var args = Array.prototype.slice.call(arguments)
  args[0] = chalk.magenta(args[0])
  return [
    chalk.white('evalmd'),
    chalk.blue('debug')
  ].concat(args).join(' ')
}

function cleanStack(errOrStack) {
  if (errOrStack && errOrStack.stack) return String(errOrStack).split(/\r\n?|\n/)
  if (Array.isArray(errOrStack)) return errOrStack
  if (errOrStack) return String(errOrStack).split(/\r\n?|\n/)
  return false
}

function logErr(err) {
  var lines = cleanStack(err)
  if (lines) {
    lines.forEach(function (line) {
      return log(errMsg(line))
    })
  }
  return lines
}

function logInfo() {
  var args = Array.prototype.slice.call(arguments)
  return log(infoMsg.apply(null, args))
}

function logDebug() {
  var args = Array.prototype.slice.call(arguments)
  if (DEBUG) return log(debugMsg.apply(null, args))
}

function logFactory(store, silence) {
  return function (data) {
    var colorLessData = chalk.stripColor(data)
    if (!store.all) store.all = []
    store.push(colorLessData)
    if (!silence) return process.stderr.write(data + '\n')
  }
}

function acornError(nodes, filePath) {
  return function (e) {
    if (!e.stack) return e
    console.log(e)
    var stack = e.stack
    stack = stackSplit(stack)
    var lineChar = [e.loc.line, ':', e.loc.column].join('')
    var errorNode = findErrorNode(nodes, e.loc.line)
    var absFilePath = path.resolve(filePath)
    var line = ['    at ', absFilePath, ':', lineChar, ' {block ', errorNode.id, '}'].join('')
    stack.lines = [line]
    return stackJoin(stack)
  }
}

function parseLineChar(s) {
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

function getCleanLines(incLines, nodes, absFilePath, frame) {
  var lines = incLines.map(function (line) {
    var lineChar = parseLineChar(line)
    var matchNodes = nodes.find(function (node) {
      if (!node.fileEvalHashPath) return false
      return line.match(node.fileEvalHashPath)
    })
    var matchNode = (function () {
      if (!nodes.fileEvalHashPath) return false
      var match = line.match(nodes.fileEvalHashPath)
      if (!match) return false
      var errorNode = findErrorNode(nodes, lineChar.line)
      if (errorNode && errorNode.id) nodes.id = errorNode.id
      return nodes
    }())
    var match = matchNodes || matchNode || false

    var replacement = (function () {
      if (!match) return false
      var lineChar = parseLineChar(line)
      var str = []
      if (!frame) str.push('    at ')
      str.push(absFilePath)
      if (lineChar.line && lineChar.char) str.push(':' + lineChar.line + ':' + lineChar.char)
      if (lineChar.line && !lineChar.char) str.push(':' + lineChar.line)
      if (match.id && !match.fileEval) str.push(' {block ' + match.id + '}')
      if (match.id && match.fileEval) str.push(' {block ' + match.id + ' (' + match.fileEval + ')}')
      return str.join('')
    }())
    return {
      'line': line,
      'replacement': replacement
    }
  })
  // console.log(lines)
  lines = lines.reverse()
  var matchFound = false
  if (!frame) {
    lines = lines.filter(function (line) {
      if (line.replacement) matchFound = true
      return matchFound
    })
  }
  lines = lines.map(function (line) {
    if (line.replacement) return line.replacement
    return line.line
  })
  return lines.reverse()
}

function evalError(filePath, nodes) {
  return function (e) {
    if (!e.stack) return e
    var stack = stackSplit(e.stack)
    var absFilePath = path.resolve(filePath)
    var cleanLines = getCleanLines(stack.lines, nodes, absFilePath, false)
    if (cleanLines.length !== 0) stack.lines = cleanLines
    stack.frame = getCleanLines(stack.frame, nodes, absFilePath, true)
    stack.frame.shift()
    if (stack.frame[stack.frame.length - 1] === '') stack.frame.pop()
    return stackJoin(stack)
  }
}

function evalFileAsync(file) {
  return new Promise(function (resolve, reject) {
    var command = [process.execPath, file].join(' ')
    return child_process.exec(command, function (error, stdout, stderr) {
      if (stdout) process.stdout.write(stdout)
      if (error) return reject(error)
      return resolve({
        stdout: stdout,
        stderr: stderr
      })
    })
  })
}

function getCleanErr(error, stackWrapper) {
  if (stackWrapper) return stackWrapper(error)
  if (error.stack) return error.stack
  return error
}

function nonstopErr(error, stackWrapper, nonstop) {
  var cleanErr = getCleanErr(error, stackWrapper)
  if (nonstop) {
    logErr(cleanErr)
    return error
  } else {
    throw cleanErr
  }
}

function evaluate(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath) {
  return promiseRipple(node, {
    notice: function (node) {
      var ids = (Array.isArray(node)) ? node.map(function (n) { return n.id }) : [node.id]
      var word = (ids.length > 1) ? 'blocks' : 'block'
      logInfo(filePath, ['running', word, ids.join(', ')].join(' '))
    },
    evalCode: function (node) {
      var stackWrapper = acornError(nodes, filePath)
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend)
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop)
      }
    },
    fileName: function (node) {
      node.fileEvalHash = (node.fileEval) ? getHash(node.fileEval) : getHash(filePath + node.id)
      node.fileEvalHashPath = path.join(temp, node.fileEvalHash + '.js')
      return node
    },
    fileCreated: function (node) {
      if (!node.evalCode || node.evalCode instanceof Error) return false
      var dirs = path.dirname(node.fileEvalHashPath)
      return fs.mkdirsAsync(dirs)
      .then(function () {
        return fs.writeFileAsync(node.fileEvalHashPath, node.evalCode.preserveAlter)
        .then(function () {
          return true
        })
      })
    },
    evalResult: function (node) {
      if (!node.fileCreated) return false
      var stackWrapper = evalError(filePath, nodes)
      return evalFileAsync(node.fileEvalHashPath)
        .catch(function (error) {
          return nonstopErr(error, stackWrapper, nonstop)
        })
    },
    fileRemove: function (node) {
      if (!node.fileCreated) return false
      return fs.unlinkAsync(node.fileEvalHashPath)
    }
  })
}

function evaluateScope(nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, blockScope) {
  if (blockScope) {
    return promiseSeries(nodes, function (node, index, nodes) {
      return evaluate(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath)
    })
  } else {
    return evaluate(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath)
    .then(function (node) {
      return [node]
    })
  }
}

function outputCode(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter) {
  return promiseRipple(node, {
    notice: function (node) {
      var ids = (Array.isArray(node)) ? node.map(function (n) { return n.id }) : [node.id]
      var word = (ids.length > 1) ? 'blocks' : 'block'
      logInfo(filePath, ['outputting', word, ids.join(', ')].join(' '))
    },
    evalCode: function (node) {
      var stackWrapper = acornError(nodes, filePath)
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend)
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop)
      }
    },
    output: function (node) {
      if (node.evalCode instanceof Error) return false
      if (output === true) output = 'preserve'
      process.stdout.write(node.evalCode[output])
      delimeter = (delimeter === true) ? '//EVALMD-STDOUT-FILE-DELIMETER' : delimeter
      if (delimeter) process.stdout.write(delimeter)
      return true
    }
  })
}

function outputScope(nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, blockScope, output, delimeter) {
  if (blockScope) {
    return promiseSeries(nodes, function (node, index, nodes) {
      return outputCode(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter)
    })
  } else {
    return outputCode(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter)
    .then(function (node) {
      return [node]
    })
  }
}

function assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter) {
  // get the markdown file contents
  return promiseRipple({
    markdown: function (data) {
      return fs.readFileAsync(filePath, 'utf8')
    },
    processNodes: function (data) {
      // create new md instance
      var md = new MarkdownIt()
      // split the markdown file by lines
      data.markdownLines = String(data.markdown || '').split(/\r\n?|\n/)
      // get all the nodes
      data.nodes = md.parse(data.markdown, {})
      // map all the nodes
      data.nodes = mapNodes(data.nodes, filePath)
      // get all js / javascript fenced blocks
      data.allFences = getFences(data.nodes, ['js', 'javascript'])
      // get all hashes
      data.allJsFences = getNodeId(data.allFences, filePath)
      // get all permitted blocks
      data.permittedFences = filterPrevented(data.allJsFences)
      // eval nodes
      data.evalNodes = (includePrevented) ? data.allJsFences : data.permittedFences
      // get the blockscope
      data.blockScope = blockScope || Boolean(data.evalNodes.map(function (node) { return node.fileEval }).filter(function (fileEval) { return fileEval !== false }).length)
      return data
    },
    evaluated: function (data) {
      if (preventEval) {
        logInfo('eval prevented')
        return false
      }
      if (!data.evalNodes.length) {
        logInfo('no blocks to eval')
        return false
      }
      return evaluateScope(data.evalNodes, data.markdownLines.length, pkg, prepend, nonstop, filePath, data.blockScope)
    },
    outputed: function (data) {
      if (!output) {
        return false
      }
      return outputScope(data.evalNodes, data.markdownLines.length, pkg, prepend, nonstop, filePath, data.blockScope, output, delimeter)
    }
  })
}

module.exports = main
module.exports.getExitCode = getExitCode;
module.exports.getPackage = getPackage;
module.exports.previousIndex = previousIndex;
module.exports.previousIndexType = previousIndexType;
module.exports.previousIndexClose = previousIndexClose;
module.exports.groupChildren = groupChildren;
module.exports.searchLink = searchLink;
module.exports.searchComment = searchComment;
module.exports.createLineDoc = createLineDoc;
module.exports.replaceLines = replaceLines;
module.exports.getHash = getHash;
module.exports.mapNodes = mapNodes;
module.exports.getNodeId = getNodeId;
module.exports.getFences = getFences;
module.exports.filterPrevented = filterPrevented;
module.exports.buildPreserveLines = buildPreserveLines;
module.exports.buildConcat = buildConcat;
module.exports.getDeps = getDeps;
module.exports.replacePosition = replacePosition;
module.exports.regExpEscape = regExpEscape;
module.exports.alterAssignedModule = alterAssignedModule;
module.exports.alterSelfModules = alterSelfModules;
module.exports.alterPrependModules = alterPrependModules;
module.exports.alterNpmModules = alterNpmModules;
module.exports.alterModules = alterModules;
module.exports.buildEvalable = buildEvalable;
module.exports.stackSplit = stackSplit;
module.exports.stackJoin = stackJoin;
module.exports.findErrorNode = findErrorNode;
module.exports.errMsg = errMsg;
module.exports.infoMsg = infoMsg;
module.exports.debugMsg = debugMsg;
module.exports.cleanStack = cleanStack;
module.exports.logErr = logErr;
module.exports.logInfo = logInfo;
module.exports.logDebug = logDebug;
module.exports.logFactory = logFactory;
module.exports.acornError = acornError;
module.exports.parseLineChar = parseLineChar;
module.exports.getCleanLines = getCleanLines;
module.exports.evalError = evalError;
module.exports.evalFileAsync = evalFileAsync;
module.exports.getCleanErr = getCleanErr;
module.exports.nonstopErr = nonstopErr;
module.exports.evaluate = evaluate;
module.exports.evaluateScope = evaluateScope;
module.exports.outputCode = outputCode;
module.exports.outputScope = outputScope;
module.exports.assemble = assemble;

// .then(console.log)

// .then(function (report) {
//   console.log(report[0].evaluated)
// })

// console.log(JSON.stringify(nodes, null, 2))

  // var childrenSets = map(subNodes, 'children')
  // if (!childrenSets.length) return false
  // var found = find(childrenSets, function (children) {
  //   return find(children, function (child) {
  //     if (child.type === 'link_open') {
  //       if (!child.attrs) return false
  //       var hrefIndex = child.attrIndex('href')
  //       var hrefValue = child.attrs[hrefIndex][1]
  //       return hrefValue.match(/(eval\s?file|file\s?eval)/i)
  //     } else if (child.type === 'text') {
  //       return child.content.match(/\[\]\(#?(eval\s?file|file\s?eval)\)/i)
  //     }
  //     return false
  //   })
  // })
  // console.log(found)
  // return found
// }

// var previousSiblingFileEval = main.previousSiblingFileEval = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   var subNodes = slice(nodes, node.previousFenceIndex, index)
//   var childrenSets = map(subNodes, 'children')
//   childrenSets = flatten(childrenSets)
//   if (!childrenSets.length) return false
//   var found = find(childrenSets, function (children) {
//     return find(children, function (child) {
//       if (child.type === 'link_open') {
//         if (!child.attrs) return false
//         var hrefIndex = child.attrIndex('href')
//         var hrefValue = child.attrs[hrefIndex][1]
//         return hrefValue.match(/eval\s?file|file\s?eval/i)
//       }
//       return false
//     })
//   })
//   console.log(found)
// var text = find(found, {
//   'type': 'text'
// })
// return (text && text.content) ? text.content : false
// }

// var commentPreventEval = main.commentPreventEval = function (node) {
//   var options = [
//     Boolean(node.content.match(/^\/\/ prevent eval/i)),
//     Boolean(node.content.match(/^\/\/ preventeval/i)),
//     Boolean(node.content.match(/^\/\/ eval prevent/i)),
//     Boolean(node.content.match(/^\/\/ evalprevent/i))
//   ]
//   return includes(options, true)
// }
//
// block.assignFileViaComment = block.code.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
//
// var commentPreventEval = main.commentPreventEval = function (node) {
//
// }

// var preventEval = main.preventEval = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   var subNodes = slice(nodes, node.prevFenceIndex, index)
//   var result = find(subNodes, function (node) {
//     if (!node.children) return false
//     return find(node.children, function (childElement) {
//       if (childElement.type == "link_open") {
//         var hrefIndex = childElement.attrIndex('href')
//         var hrefValue = childElement.attrs[hrefIndex][1]
//         return hrefValue
//       }
//       if (childElement.type == "text") {
//         var hrefIndex = childElement.attrIndex('href')
//         var hrefValue = childElement.attrs[hrefIndex][1]
//
//       }
      // return find(childElement, function (child) {
      //   if (child.type !== 'link_open') return false
      //   var hrefIndex = child.attrIndex('href')
      //   var hrefValue = child.attrs[hrefIndex][1]
      //   console.log(hrefValue)
      //   var options = [
      //     Boolean(hrefValue.match(/prevent eval/i)),
      //     Boolean(hrefValue.match(/preventeval/i)),
      //     Boolean(hrefValue.match(/eval prevent/i)),
      //     Boolean(hrefValue.match(/evalprevent/i))
      //   ]
      //   return includes(options, true)
      // })
//     })
//   })
//   return Boolean(result)
// }
  // var index = indexOf(nodes, node)
  // var haystack = slice(nodes, node.prevFenceIndex, index)
  // var needle = find(haystack, function (node) {
  //   if (!node.children) return false
  //   return find(node.children, function (child) {
  //     if (child.type !== 'link_open') return false
  //     if (!child.attrs) return false
  //     var hrefIndex = child.attrIndex('href')
  //     var hrefValue = child.attrs[hrefIndex][1]
  //     var options = [
  //       Boolean(hrefValue.match(/prevent eval/i)),
  //       Boolean(hrefValue.match(/preventeval/i)),
  //       Boolean(hrefValue.match(/eval prevent/i)),
  //       Boolean(hrefValue.match(/evalprevent/i))
  //     ]
  //     return includes(options, true)
  //   })
  // })
  // return Boolean(needle)
// }

// nodes = map(nodes, function (node) {
//   node.children = elements(node.children)
//   node.prevFenceIndex = prevIndex(node, nodes, 'fence')
//   // console.log(node.children)
//   node.preventEval = preventEval(node, nodes)
//   // node.fileEval = fileEval(node, nodes)
//   return node
// })

// console.log(nodes)

// var preventEval = main.preventEval = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   var haystack = slice(nodes, node.prevFenceIndex, index)
//   var needle = find(haystack, function (node) {
//     if (!node.children) return false
//     return find(node.children, function (child) {
//       if (child.type !== 'link_open') return false
//       if (!child.attrs) return false
//       var hrefIndex = child.attrIndex('href')
//       var hrefValue = child.attrs[hrefIndex][1]
//       var options = [
//         Boolean(hrefValue.match(/prevent eval/i)),
//         Boolean(hrefValue.match(/preventeval/i)),
//         Boolean(hrefValue.match(/eval prevent/i)),
//         Boolean(hrefValue.match(/evalprevent/i))
//       ]
//       return includes(options, true)
//     })
//   })
//   return Boolean(needle)
// }
//
// var fileEval = main.fileEval = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   var haystack = slice(nodes, node.prevFenceIndex, index)
//
//   var needle = find(haystack, function (node) {
//     if (!node.children) return false
//     return find(node.children, function (child) {
//       if (child.type !== 'link_open') return false
//       if (!child.attrs) return false
//       var hrefIndex = child.attrIndex('href')
//       var hrefValue = child.attrs[hrefIndex][1]
//       var options = [
//         Boolean(hrefValue.match(/file eval/i)),
//         Boolean(hrefValue.match(/fileeval/i)),
//         Boolean(hrefValue.match(/eval file/i)),
//         Boolean(hrefValue.match(/evalfile/i))
//       ]
//       return includes(options, true)
//     })
//   })
//
//   if (!needle) return false
//
//   console.log(needle)
// }

// console.log(nodes)

// var fileName = main.fileName = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   var haystack = slice(nodes, node.prevFenceIndex, index)
//
//   return map(haystack, function (node, index) {
//     node.children = map(node.children, function (child) {
//       var prevLinkOpen = prevIndex(child, node.children, 'link_open')
//       var index = indexOf(node.children, child)
//       console.log([prevLinkOpen, index])
//       var haystack = slice(node.children, prevLinkOpen, index)
//
//       console.log(haystack)

// var needle = find(haystack, function (child) {
//
//   return find(node.children, function (child) {
//     var hrefIndex = child.attrIndex('href')
//     var hrefValue = child.attrs[hrefIndex][1]
//     var options = [
//       Boolean(hrefValue.match(/prevent eval/i)),
//       Boolean(hrefValue.match(/preventeval/i)),
//       Boolean(hrefValue.match(/eval prevent/i)),
//       Boolean(hrefValue.match(/evalprevent/i))
//     ]
//     return includes(options, true)
//   })
// })

// console.log(needle)

//   })
// })

// if (!node.children) return node
// var lastLink = findIndex(node.children, function (child) {
//   if (child.type !== 'link_open') return false
//   if (!child.attrs) return false
//   var hrefIndex = child.attrIndex('href')
//   var hrefValue = child.attrs[hrefIndex][1]
//   var options = [
//     Boolean(hrefValue.match(/file eval/i)),
//     Boolean(hrefValue.match(/fileeval/i)),
//     Boolean(hrefValue.match(/eval file/i)),
//     Boolean(hrefValue.match(/evalfile/i))
//   ]
//   return includes(options, true)
// })
// // console.log(lastLink)
// // var index(node, lastLink)
// var haystack = slice(nodes, lastLink, index)
// console.log(haystack)

// var subNeedles = map(haystack, function (node) {
//   if (!node.children) return false
//   var node = find(node.children, function (child) {
//     if (child.type !== 'link_open') return false
//     if (!child.attrs) return false
//     var hrefIndex = child.attrIndex('href')
//     var hrefValue = child.attrs[hrefIndex][1]
//     var options = [
//       Boolean(hrefValue.match(/file eval/i)),
//       Boolean(hrefValue.match(/fileeval/i)),
//       Boolean(hrefValue.match(/eval file/i)),
//       Boolean(hrefValue.match(/evalfile/i))
//     ]
//     return includes(options, true)
//   })
//   var lastLinkOpenIndex = prevIndex(node, nodes, 'link_open')
//   var haystack = slice(nodes, lastLinkOpenIndex, index)
//   return find(haystack, function (child) {
//     return child.type === "text"
//   })
// })
// }

// console.log(JSON.stringify(nodes, null, 2))
// console.log(nodes)

// each(nodes, function (node) {
//   if (node.type === 'inline') {
//     each(node.children, function (child) {
//       if (child.attrs) {
//         var hrefIndex = child.attrIndex('href')
//         var hrefValue = child.attrs[hrefIndex][1]
//         console.log(hrefValue)
//       }
//     })
//   }
// })

// var prevented = main.prevented = function (node, nodes) {
//   var index = indexOf(nodes, node)
//   return [i, index]
//   // var hay = split(arr, start, end)
//   // return find(hay, {
//   //   'prevent': true
//   // })
// }

// var anchor = main.anchor = function (node) {
//   var anchor = {}
//   anchor.text = undefined
//   anchor.href = undefined
//   if (node.type === 'inline' && node.content) {
//     var pattern = /\[(.+)?\]\((.+)?\)/
//     var pieces = node.content.match(pattern)
//     if (!pieces) return anchor
//     anchor.text = pieces[1]
//     anchor.href = pieces[2]
//   }
//   return anchor
// }

// if (!node.type.match('_close')) return null
// if (!node.type.match('_close')) return null
// var subNodes = slice(nodes, index + 1)
// var endingIndex = findIndex(subNodes, node.tag)

// return slice(index, endingIndex)

    //
    //   var pieceHref = find(child, function (piece) {
    //     if (piece.type !== 'link_open') return false
    //     if (!piece.attrs) return false
    //     var hrefIndex = piece.attrIndex('href')
    //     var hrefValue = piece.attrs[hrefIndex][1]
    //     return (hrefValue.match(/(eval\s?file|file\s?eval)/i))
    //   })
    //   console.log(pieceHref)
    //   if (pieceText[0] && pieceText[1]) return pieceText[1]
    //   if (pieceHref) return pieceHref[0]
    //   return false
    // })

// var addEvalCode = main.addEvalCode = function (nodes, blockScope, markdownLinesLength, pkg, prepend, nonstop) {
//   return map(nodes, function (node) {
//     node.evalCode = false
//     if (!blockScope) return node
//     node.evalCode = catchNonstop(function () {
//       var evalables = buildEvalable(node, markdownLinesLength, pkg, prepend)
//       return evalables.preserveAlter
//     }, nonstop)
//     return node
//   })
// }

// var writeTemp = main.writeTemp = function (nodes, markdownLinesLength, pkg, prepend) {
//   return Promise.map(nodes, function (node) {
//     if (node.fileEvalHashPath && node.evalCode) {
//       var dirs = path.dirname(node.fileEvalHashPath)
//       return fs.mkdirsAsync(dirs)
//         .then(function () {
//         return fs.writeFileAsync(node.fileEvalHashPath, buildPermittedPreserveAlt)
//         .then(function () {
//           return node.fileEvalHashPath
//         })
//       })
//     } else {
//       return false
//     }
//   })
// }

// function InvalidValueError(value, type) {
//   // this.message = "Expected `" + type.name + "`: " + value;
//   var error = new Error(this.message);
//   this.stack = error.stack;
// }
// InvalidValueError.prototype = new Error();
// InvalidValueError.prototype.name = InvalidValueError.name;
// InvalidValueError.prototype.constructor = InvalidValueError;

// var Evacuate = main.Evacuate = function (e) {
//   this.stack = e.stack
//   this.message = e.message
//   this.name = 'Evacuate'
//   this.message = e.message || e || ''
//   if (!(e instanceof Error)) var e = new Error(this.message)
//   e.name = this.name
//   this.stack = e.stack
// }
// Evacuate.prototype = Error.prototype
//
// var foo = new Error('hi')
// var bar = new InvalidValueError()
// throw bar

// [![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/reggi/evalmd/trend.png)](https://bitdeli.com/free "Bitdeli Badge")

// var fileEval = main.fileEval = function (node, nodes) {
//   // get the index for the node
//   var index = indexOf(nodes, node)
//   // split the nodes get all between last fence and this node
//   var subNodes = slice(nodes, node.previousFenceIndex, index)
//   // map loop / find
//
//   // get the href value
//   var href = chain(subNodes).map(function (node) {
//     return find(node.children, function (child) {
//       return find(child, function (piece) {
//         if (piece.type !== 'link_open') return false
//         if (!piece.attrs) return false
//         var hrefIndex = piece.attrIndex('href')
//         var hrefValue = piece.attrs[hrefIndex][1]
//         return hrefValue.match(/(eval\s?file|file\s?eval)/i)
//       })
//     })
//   }).flattenDeep().without(false).value()
//   // if heref get the text of the href
//   if (href) {
//     var hrefText = find(href, {
//       'type': 'text'
//     })
//     if (hrefText && hrefText.content) {
//       return hrefText.content
//     }
//   }
//   // check first line for comment declaration
//   var commentMatch = node.content.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
//   // if there's a first-line comment match return the value
//   if (commentMatch && commentMatch[2]) {
//     return commentMatch[2]
//   }
//   // return false if all-else fails
//   return false
// }
//
//
// var preventEval = main.preventEval = function (node, nodes) {
//   // get the nodes
//
//   // search through children nodes
//   var value = map(subNodes, function (node) {
//     return map(node.children, function (child) {
//       var pieceText = find(child, function (piece) {
//         if (piece.type !== 'text') return false
//         return piece.content.match(/\[\]\(#?(eval\s?prevent|prevent\s?eval)\)/i)
//       })
//       var pieceHref = find(child, function (piece) {
//         if (piece.type !== 'link_open') return false
//         if (!piece.attrs) return false
//         var hrefIndex = piece.attrIndex('href')
//         var hrefValue = piece.attrs[hrefIndex][1]
//         return hrefValue.match(/(eval\s?prevent|prevent\s?eval)/i)
//       })
//       return pieceText || pieceHref || false
//     })
//   })
//   // clean up the child nodes
//   var found = chain(value).flatten().without(false).value()
//   // if child nodes match return true
//   if (found && found.length) {
//     return true
//   }
//   // check first line for comment declaration
//   var commentMatch = node.content.match(/\/\/\s(prevent\s?eval\s|eval\s?prevent\s)(.+)/i)
//   // if there's a first-line comment match return true
//   if (commentMatch) {
//     return true
//   }
//   // return false if all-else fails
//   return false
// }

    // node.preventEval = preventEval(node, nodes)
    // node.fileEval = fileEval(node, nodes)
//
// var fileEval = main.fileEval = function (node, nodes) {
//   // get the index for the node
//   var index = indexOf(nodes, node)
//   // split the nodes get all between last fence and this node
//   var subNodes = slice(nodes, node.previousFenceIndex, index)
//   // map loop / find
//   var text = chain(subNodes).map(function (node) {
//     return map(node.children, function (child) {
//       return map(child, function (piece) {
//         if (piece.type !== 'text') return false
//         return piece.content.match(/\[(.+?)\]\(#?(eval\s?file|file\s?eval)\)/i)
//       })
//     })
//   }).flattenDeep().without(false).value()
//   // return file if match has been made
//   if (text && text[1]) {
//     return text[1]
//   }
//   // get the href value
//   var href = chain(subNodes).map(function (node) {
//     return find(node.children, function (child) {
//       return find(child, function (piece) {
//         if (piece.type !== 'link_open') return false
//         if (!piece.attrs) return false
//         var hrefIndex = piece.attrIndex('href')
//         var hrefValue = piece.attrs[hrefIndex][1]
//         return hrefValue.match(/(eval\s?file|file\s?eval)/i)
//       })
//     })
//   }).flattenDeep().without(false).value()
//   // if heref get the text of the href
//   if (href) {
//     var hrefText = find(href, {
//       'type': 'text'
//     })
//     if (hrefText && hrefText.content) {
//       return hrefText.content
//     }
//   }
//   // check first line for comment declaration
//   var commentMatch = node.content.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
//   // if there's a first-line comment match return the value
//   if (commentMatch && commentMatch[2]) {
//     return commentMatch[2]
//   }
//   // return false if all-else fails
//   return false
// }

//
// var searchLink = main.searchLink = function (subNodes, pattern) {
//   // console.log(subNodes)
//   var href = chain(subNodes).map(function (node) {
//     return find(node.children, function (child) {
//       return find(child, function (piece) {
//         if (piece.type !== 'link_open') return false
//         if (!piece.attrs) return false
//         var hrefIndex = piece.attrIndex('href')
//         var hrefValue = piece.attrs[hrefIndex][1]
//         return hrefValue.match(pattern)
//       })
//     })
//   }).flattenDeep().without(false).value()
//   // if heref get the text of the href
//   if (href) {
//     var hrefText = find(href, {
//       'type': 'text'
//     })
//     if (hrefText && hrefText.content) {
//       return hrefText.content
//     } else if (hrefText) {
//       return true
//     }
//   }
//   return false
// }
