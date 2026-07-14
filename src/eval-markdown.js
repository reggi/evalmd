'use strict';

const { flatten } = require('lodash');
const promisify = require('util.promisify');
const nodeFs = require('fs');
const MarkdownIt = require('markdown-it');
const promiseRipple = require('./promise-ripple');
const resolveParse = require('./eslint-parse');
const createLogger = require('./log');
const {
  previousIndex,
  previousIndexType,
  previousIndexClose,
  groupChildren,
  searchLink,
  searchComment,
  createLineDoc,
  replaceLines,
  getHash,
  mapNodes,
  getNodeId,
  getFences,
  filterPrevented,
  buildPreserveLines,
  buildConcat,
} = require('./md-nodes');
const {
  stackSplit,
  stackJoin,
  findErrorNode,
  acornError,
  parseLineChar,
  getCleanLines,
} = require('./eval-errors');
const {
  KIND_LANGS,
  normalizeKinds,
  parsePromptBlock,
} = require('./shell-eval');
const {
  replacePosition,
  regExpEscape,
  getDeps,
  alterAssignedModule,
  alterSelfModules,
  alterPrependModules,
  alterNpmModules,
  alterModules,
  buildEvalable,
} = require('./module-rewrite');
const {
  evalError,
  evalFileAsync,
  getCleanErr,
  nonstopErr,
  evaluate,
  evaluateScope,
  outputCode,
  outputScope,
  evaluateShell,
  evaluateAllKinds,
} = require('./eval-run');

const fs = {
  readFileAsync: promisify(nodeFs.readFile),
};

/** @import { AssembleData, Logger, Package } from './types' */

/** @param {readonly AssembleData[]} mdResults */
function getExitCode(mdResults) {
  const evaluations = flatten(mdResults.map((mdResult) => mdResult.evaluated || []));
  const evalResults = flatten(evaluations.map((evaluation) => evaluation.evalResult));
  const evalResultsInstanceofError = evalResults.map((evalResult) => evalResult instanceof Error);
  const evalResultsHasInstanceofError = evalResultsInstanceofError.indexOf(true) !== -1;
  if (evalResultsHasInstanceofError) { return 1; }
  return 0;
}

/** @param {string} [packagePath] */
function getPackage(packagePath) {
  packagePath = (packagePath) ? packagePath : './package.json';
  return fs.readFileAsync(packagePath, 'utf8')
    .then(JSON.parse)
    .then((pkg) => {
      pkg.path = packagePath;
      return pkg;
    })
    .catch(() => false);
}

/**
 * @param {string} filePath
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} blockScope
 * @param {boolean} nonstop
 * @param {boolean} preventEval
 * @param {boolean} includePrevented
 * @param {string | boolean} output
 * @param {string | boolean} delimeter
 * @param {readonly string[]} evalLangs
 * @param {boolean} useEslint
 * @param {Logger} logger
 * @param {boolean} sloppy
 * @returns {Promise<AssembleData>}
 */
function assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter, evalLangs, useEslint, logger, sloppy) {
  // get the markdown file contents
  /** @type {AssembleData} */
  const initial = {};
  return promiseRipple(initial, {
    markdown() {
      return fs.readFileAsync(filePath, 'utf8');
    },
    /** @param {AssembleData} data */
    processNodes(data) {
      // create new md instance
      const md = new MarkdownIt();
      // split the markdown file by lines
      data.markdownLines = String(data.markdown || '').split(/\r\n?|\n/);
      // get all the nodes
      data.nodes = md.parse(String(data.markdown || ''), {});
      // map all the nodes
      data.nodes = mapNodes(data.nodes);
      // get all js / javascript fenced blocks
      data.allFences = getFences(data.nodes, ['js', 'javascript']);
      // get all hashes
      data.allJsFences = getNodeId(data.allFences);
      // get all permitted blocks
      data.permittedFences = filterPrevented(data.allJsFences);
      // eval nodes
      data.kinds = normalizeKinds(evalLangs);
      const evalJs = data.kinds.indexOf('js') !== -1;
      data.evalNodes = (evalJs) ? ((includePrevented) ? data.allJsFences : data.permittedFences) : [];
      data.kindFences = {};
      const kindFences = data.kindFences;
      const kindNodes = data.nodes || [];
      data.kinds.forEach((kind) => {
        if (kind === 'js') { return; }
        kindFences[kind] = getNodeId(getFences(kindNodes, KIND_LANGS[kind] || [kind]));
      });
      // get the blockscope
      data.blockScope = blockScope
        || Boolean(data.evalNodes.map((node) => node.fileEval).filter((fileEval) => fileEval !== false).length);
      return data;
    },
    /** @param {AssembleData} data */
    resolvedParsers(data) {
      if (!useEslint) { return false; }
      return Promise.all((data.evalNodes || []).map((node) => resolveParse(filePath, String(node.id), process.cwd()).then((parse) => {
        node.parse = parse;
        return node.id;
      })));
    },
    /** @param {AssembleData} data */
    evaluated(data) {
      if (preventEval) {
        logger.info('eval prevented');
        return false;
      }
      return evaluateAllKinds(data, pkg, prepend, nonstop, filePath, logger, sloppy);
    },
    /** @param {AssembleData} data */
    outputed(data) {
      if (!output) {
        return false;
      }
      if (!data.evalNodes || !data.markdownLines) { return false; }
      return outputScope(data.evalNodes, data.markdownLines.length, pkg, prepend, nonstop, filePath, Boolean(data.blockScope), output, delimeter, logger, sloppy);
    },
  });
}

/**
 * :fishing_pole_and_fish: Evaluates javascript code blocks from markdown files.
 * @module evalmd
 * @package.keywords eval, evaulate, javascript, markdown, test
 * @package.preferGlobal
 * @package.bin.evalmd ./bin/eval-markdown.js
 * @package.bin.test-markdown ./bin/eval-markdown.js
 * @package.bin.eval-markdown ./bin/eval-markdown.js
 * @param {string | readonly string[]} filePath$
 * @param {string} packagePath
 * @param {string} prepend
 * @param {boolean} blockScope
 * @param {boolean} nonstop
 * @param {boolean} preventEval
 * @param {boolean} includePrevented
 * @param {boolean} silence
 * @param {boolean} debug
 * @param {string | boolean} output
 * @param {string | boolean} delimeter
 * @param {readonly string[]} evalLangs
 * @param {boolean} sloppy
 * @param {boolean} useEslint
 */
function main(filePath$, packagePath, prepend, blockScope, nonstop, preventEval, includePrevented, silence, debug, output, delimeter, evalLangs, sloppy, useEslint) {
  evalLangs = (evalLangs && evalLangs.length) ? evalLangs : ['js'];
  const logger = createLogger({ debug, silence });
  const filePaths = flatten([filePath$]);
  logger.info('it worked if it ends with', 'ok');
  return getPackage(packagePath)
    .then((pkg) => Promise.all(filePaths.map((filePath) => assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter, evalLangs, useEslint, logger, sloppy))))
    .then((mdResults) => {
    // console.log(mdResults)
      const exitCode = getExitCode(mdResults);
      if (exitCode === 0) { logger.info('ok'); }
      logger.debug('exit code', exitCode);
      return {
        dataSets: mdResults,
        exitCode,
        log: logger.store,
      };
    })
    .catch((error) => {
      logger.err(error);
      const exitCode = 1;
      logger.debug('exit code', exitCode);
      return {
        dataSets: null,
        exitCode: 1,
        log: null,
      };
    });
}

module.exports = main;
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
module.exports.parsePromptBlock = parsePromptBlock;
module.exports.evaluateShell = evaluateShell;
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

/*
 * .then(function (report) {
 *   console.log(report[0].evaluated)
 * })
 */

// console.log(JSON.stringify(nodes, null, 2))

/*
 * var childrenSets = map(subNodes, 'children')
 * if (!childrenSets.length) return false
 * var found = find(childrenSets, function (children) {
 *   return find(children, function (child) {
 *     if (child.type === 'link_open') {
 *       if (!child.attrs) return false
 *       var hrefIndex = child.attrIndex('href')
 *       var hrefValue = child.attrs[hrefIndex][1]
 *       return hrefValue.match(/(eval\s?file|file\s?eval)/i)
 *     } else if (child.type === 'text') {
 *       return child.content.match(/\[\]\(#?(eval\s?file|file\s?eval)\)/i)
 *     }
 *     return false
 *   })
 * })
 * console.log(found)
 * return found
 * }
 */

/*
 * var previousSiblingFileEval = main.previousSiblingFileEval = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   var subNodes = slice(nodes, node.previousFenceIndex, index)
 *   var childrenSets = map(subNodes, 'children')
 *   childrenSets = flatten(childrenSets)
 *   if (!childrenSets.length) return false
 *   var found = find(childrenSets, function (children) {
 *     return find(children, function (child) {
 *       if (child.type === 'link_open') {
 *         if (!child.attrs) return false
 *         var hrefIndex = child.attrIndex('href')
 *         var hrefValue = child.attrs[hrefIndex][1]
 *         return hrefValue.match(/eval\s?file|file\s?eval/i)
 *       }
 *       return false
 *     })
 *   })
 *   console.log(found)
 * var text = find(found, {
 *   'type': 'text'
 * })
 * return (text && text.content) ? text.content : false
 * }
 */

/*
 * var commentPreventEval = main.commentPreventEval = function (node) {
 *   var options = [
 *     Boolean(node.content.match(/^\/\/ prevent eval/i)),
 *     Boolean(node.content.match(/^\/\/ preventeval/i)),
 *     Boolean(node.content.match(/^\/\/ eval prevent/i)),
 *     Boolean(node.content.match(/^\/\/ evalprevent/i))
 *   ]
 *   return includes(options, true)
 * }
 *
 * block.assignFileViaComment = block.code.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
 *
 * var commentPreventEval = main.commentPreventEval = function (node) {
 *
 * }
 */

/*
 * var preventEval = main.preventEval = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   var subNodes = slice(nodes, node.prevFenceIndex, index)
 *   var result = find(subNodes, function (node) {
 *     if (!node.children) return false
 *     return find(node.children, function (childElement) {
 *       if (childElement.type == "link_open") {
 *         var hrefIndex = childElement.attrIndex('href')
 *         var hrefValue = childElement.attrs[hrefIndex][1]
 *         return hrefValue
 *       }
 *       if (childElement.type == "text") {
 *         var hrefIndex = childElement.attrIndex('href')
 *         var hrefValue = childElement.attrs[hrefIndex][1]
 *
 *       }
 * return find(childElement, function (child) {
 *   if (child.type !== 'link_open') return false
 *   var hrefIndex = child.attrIndex('href')
 *   var hrefValue = child.attrs[hrefIndex][1]
 *   console.log(hrefValue)
 *   var options = [
 *     Boolean(hrefValue.match(/prevent eval/i)),
 *     Boolean(hrefValue.match(/preventeval/i)),
 *     Boolean(hrefValue.match(/eval prevent/i)),
 *     Boolean(hrefValue.match(/evalprevent/i))
 *   ]
 *   return includes(options, true)
 * })
 *     })
 *   })
 *   return Boolean(result)
 * }
 * var index = indexOf(nodes, node)
 * var haystack = slice(nodes, node.prevFenceIndex, index)
 * var needle = find(haystack, function (node) {
 *   if (!node.children) return false
 *   return find(node.children, function (child) {
 *     if (child.type !== 'link_open') return false
 *     if (!child.attrs) return false
 *     var hrefIndex = child.attrIndex('href')
 *     var hrefValue = child.attrs[hrefIndex][1]
 *     var options = [
 *       Boolean(hrefValue.match(/prevent eval/i)),
 *       Boolean(hrefValue.match(/preventeval/i)),
 *       Boolean(hrefValue.match(/eval prevent/i)),
 *       Boolean(hrefValue.match(/evalprevent/i))
 *     ]
 *     return includes(options, true)
 *   })
 * })
 * return Boolean(needle)
 * }
 */

/*
 * nodes = map(nodes, function (node) {
 *   node.children = elements(node.children)
 *   node.prevFenceIndex = prevIndex(node, nodes, 'fence')
 *   // console.log(node.children)
 *   node.preventEval = preventEval(node, nodes)
 *   // node.fileEval = fileEval(node, nodes)
 *   return node
 * })
 */

// console.log(nodes)

/*
 * var preventEval = main.preventEval = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   var haystack = slice(nodes, node.prevFenceIndex, index)
 *   var needle = find(haystack, function (node) {
 *     if (!node.children) return false
 *     return find(node.children, function (child) {
 *       if (child.type !== 'link_open') return false
 *       if (!child.attrs) return false
 *       var hrefIndex = child.attrIndex('href')
 *       var hrefValue = child.attrs[hrefIndex][1]
 *       var options = [
 *         Boolean(hrefValue.match(/prevent eval/i)),
 *         Boolean(hrefValue.match(/preventeval/i)),
 *         Boolean(hrefValue.match(/eval prevent/i)),
 *         Boolean(hrefValue.match(/evalprevent/i))
 *       ]
 *       return includes(options, true)
 *     })
 *   })
 *   return Boolean(needle)
 * }
 *
 * var fileEval = main.fileEval = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   var haystack = slice(nodes, node.prevFenceIndex, index)
 *
 *   var needle = find(haystack, function (node) {
 *     if (!node.children) return false
 *     return find(node.children, function (child) {
 *       if (child.type !== 'link_open') return false
 *       if (!child.attrs) return false
 *       var hrefIndex = child.attrIndex('href')
 *       var hrefValue = child.attrs[hrefIndex][1]
 *       var options = [
 *         Boolean(hrefValue.match(/file eval/i)),
 *         Boolean(hrefValue.match(/fileeval/i)),
 *         Boolean(hrefValue.match(/eval file/i)),
 *         Boolean(hrefValue.match(/evalfile/i))
 *       ]
 *       return includes(options, true)
 *     })
 *   })
 *
 *   if (!needle) return false
 *
 *   console.log(needle)
 * }
 */

// console.log(nodes)

/*
 * var fileName = main.fileName = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   var haystack = slice(nodes, node.prevFenceIndex, index)
 *
 *   return map(haystack, function (node, index) {
 *     node.children = map(node.children, function (child) {
 *       var prevLinkOpen = prevIndex(child, node.children, 'link_open')
 *       var index = indexOf(node.children, child)
 *       console.log([prevLinkOpen, index])
 *       var haystack = slice(node.children, prevLinkOpen, index)
 *
 *       console.log(haystack)
 */

/*
 * var needle = find(haystack, function (child) {
 *
 *   return find(node.children, function (child) {
 *     var hrefIndex = child.attrIndex('href')
 *     var hrefValue = child.attrs[hrefIndex][1]
 *     var options = [
 *       Boolean(hrefValue.match(/prevent eval/i)),
 *       Boolean(hrefValue.match(/preventeval/i)),
 *       Boolean(hrefValue.match(/eval prevent/i)),
 *       Boolean(hrefValue.match(/evalprevent/i))
 *     ]
 *     return includes(options, true)
 *   })
 * })
 */

// console.log(needle)

/*
 *   })
 * })
 */

/*
 * if (!node.children) return node
 * var lastLink = findIndex(node.children, function (child) {
 *   if (child.type !== 'link_open') return false
 *   if (!child.attrs) return false
 *   var hrefIndex = child.attrIndex('href')
 *   var hrefValue = child.attrs[hrefIndex][1]
 *   var options = [
 *     Boolean(hrefValue.match(/file eval/i)),
 *     Boolean(hrefValue.match(/fileeval/i)),
 *     Boolean(hrefValue.match(/eval file/i)),
 *     Boolean(hrefValue.match(/evalfile/i))
 *   ]
 *   return includes(options, true)
 * })
 * // console.log(lastLink)
 * // var index(node, lastLink)
 * var haystack = slice(nodes, lastLink, index)
 * console.log(haystack)
 */

/*
 * var subNeedles = map(haystack, function (node) {
 *   if (!node.children) return false
 *   var node = find(node.children, function (child) {
 *     if (child.type !== 'link_open') return false
 *     if (!child.attrs) return false
 *     var hrefIndex = child.attrIndex('href')
 *     var hrefValue = child.attrs[hrefIndex][1]
 *     var options = [
 *       Boolean(hrefValue.match(/file eval/i)),
 *       Boolean(hrefValue.match(/fileeval/i)),
 *       Boolean(hrefValue.match(/eval file/i)),
 *       Boolean(hrefValue.match(/evalfile/i))
 *     ]
 *     return includes(options, true)
 *   })
 *   var lastLinkOpenIndex = prevIndex(node, nodes, 'link_open')
 *   var haystack = slice(nodes, lastLinkOpenIndex, index)
 *   return find(haystack, function (child) {
 *     return child.type === "text"
 *   })
 * })
 * }
 */

/*
 * console.log(JSON.stringify(nodes, null, 2))
 * console.log(nodes)
 */

/*
 * each(nodes, function (node) {
 *   if (node.type === 'inline') {
 *     each(node.children, function (child) {
 *       if (child.attrs) {
 *         var hrefIndex = child.attrIndex('href')
 *         var hrefValue = child.attrs[hrefIndex][1]
 *         console.log(hrefValue)
 *       }
 *     })
 *   }
 * })
 */

/*
 * var prevented = main.prevented = function (node, nodes) {
 *   var index = indexOf(nodes, node)
 *   return [i, index]
 *   // var hay = split(arr, start, end)
 *   // return find(hay, {
 *   //   'prevent': true
 *   // })
 * }
 */

/*
 * var anchor = main.anchor = function (node) {
 *   var anchor = {}
 *   anchor.text = undefined
 *   anchor.href = undefined
 *   if (node.type === 'inline' && node.content) {
 *     var pattern = /\[(.+)?\]\((.+)?\)/
 *     var pieces = node.content.match(pattern)
 *     if (!pieces) return anchor
 *     anchor.text = pieces[1]
 *     anchor.href = pieces[2]
 *   }
 *   return anchor
 * }
 */

/*
 * if (!node.type.match('_close')) return null
 * if (!node.type.match('_close')) return null
 * var subNodes = slice(nodes, index + 1)
 * var endingIndex = findIndex(subNodes, node.tag)
 */

// return slice(index, endingIndex)

/*
 *
 *   var pieceHref = find(child, function (piece) {
 *     if (piece.type !== 'link_open') return false
 *     if (!piece.attrs) return false
 *     var hrefIndex = piece.attrIndex('href')
 *     var hrefValue = piece.attrs[hrefIndex][1]
 *     return (hrefValue.match(/(eval\s?file|file\s?eval)/i))
 *   })
 *   console.log(pieceHref)
 *   if (pieceText[0] && pieceText[1]) return pieceText[1]
 *   if (pieceHref) return pieceHref[0]
 *   return false
 * })
 */

/*
 * var addEvalCode = main.addEvalCode = function (nodes, blockScope, markdownLinesLength, pkg, prepend, nonstop) {
 *   return map(nodes, function (node) {
 *     node.evalCode = false
 *     if (!blockScope) return node
 *     node.evalCode = catchNonstop(function () {
 *       var evalables = buildEvalable(node, markdownLinesLength, pkg, prepend)
 *       return evalables.preserveAlter
 *     }, nonstop)
 *     return node
 *   })
 * }
 */

/*
 * var writeTemp = main.writeTemp = function (nodes, markdownLinesLength, pkg, prepend) {
 *   return Promise.map(nodes, function (node) {
 *     if (node.fileEvalHashPath && node.evalCode) {
 *       var dirs = path.dirname(node.fileEvalHashPath)
 *       return fs.mkdirsAsync(dirs)
 *         .then(function () {
 *         return fs.writeFileAsync(node.fileEvalHashPath, buildPermittedPreserveAlt)
 *         .then(function () {
 *           return node.fileEvalHashPath
 *         })
 *       })
 *     } else {
 *       return false
 *     }
 *   })
 * }
 */

/*
 * function InvalidValueError(value, type) {
 *   // this.message = "Expected `" + type.name + "`: " + value;
 *   var error = new Error(this.message);
 *   this.stack = error.stack;
 * }
 * InvalidValueError.prototype = new Error();
 * InvalidValueError.prototype.name = InvalidValueError.name;
 * InvalidValueError.prototype.constructor = InvalidValueError;
 */

/*
 * var Evacuate = main.Evacuate = function (e) {
 *   this.stack = e.stack
 *   this.message = e.message
 *   this.name = 'Evacuate'
 *   this.message = e.message || e || ''
 *   if (!(e instanceof Error)) var e = new Error(this.message)
 *   e.name = this.name
 *   this.stack = e.stack
 * }
 * Evacuate.prototype = Error.prototype
 *
 * var foo = new Error('hi')
 * var bar = new InvalidValueError()
 * throw bar
 */

// [![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/reggi/evalmd/trend.png)](https://bitdeli.com/free "Bitdeli Badge")

/*
 * var fileEval = main.fileEval = function (node, nodes) {
 *   // get the index for the node
 *   var index = indexOf(nodes, node)
 *   // split the nodes get all between last fence and this node
 *   var subNodes = slice(nodes, node.previousFenceIndex, index)
 *   // map loop / find
 *
 *   // get the href value
 *   var href = chain(subNodes).map(function (node) {
 *     return find(node.children, function (child) {
 *       return find(child, function (piece) {
 *         if (piece.type !== 'link_open') return false
 *         if (!piece.attrs) return false
 *         var hrefIndex = piece.attrIndex('href')
 *         var hrefValue = piece.attrs[hrefIndex][1]
 *         return hrefValue.match(/(eval\s?file|file\s?eval)/i)
 *       })
 *     })
 *   }).flattenDeep().without(false).value()
 *   // if heref get the text of the href
 *   if (href) {
 *     var hrefText = find(href, {
 *       'type': 'text'
 *     })
 *     if (hrefText && hrefText.content) {
 *       return hrefText.content
 *     }
 *   }
 *   // check first line for comment declaration
 *   var commentMatch = node.content.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
 *   // if there's a first-line comment match return the value
 *   if (commentMatch && commentMatch[2]) {
 *     return commentMatch[2]
 *   }
 *   // return false if all-else fails
 *   return false
 * }
 *
 *
 * var preventEval = main.preventEval = function (node, nodes) {
 *   // get the nodes
 *
 *   // search through children nodes
 *   var value = map(subNodes, function (node) {
 *     return map(node.children, function (child) {
 *       var pieceText = find(child, function (piece) {
 *         if (piece.type !== 'text') return false
 *         return piece.content.match(/\[\]\(#?(eval\s?prevent|prevent\s?eval)\)/i)
 *       })
 *       var pieceHref = find(child, function (piece) {
 *         if (piece.type !== 'link_open') return false
 *         if (!piece.attrs) return false
 *         var hrefIndex = piece.attrIndex('href')
 *         var hrefValue = piece.attrs[hrefIndex][1]
 *         return hrefValue.match(/(eval\s?prevent|prevent\s?eval)/i)
 *       })
 *       return pieceText || pieceHref || false
 *     })
 *   })
 *   // clean up the child nodes
 *   var found = chain(value).flatten().without(false).value()
 *   // if child nodes match return true
 *   if (found && found.length) {
 *     return true
 *   }
 *   // check first line for comment declaration
 *   var commentMatch = node.content.match(/\/\/\s(prevent\s?eval\s|eval\s?prevent\s)(.+)/i)
 *   // if there's a first-line comment match return true
 *   if (commentMatch) {
 *     return true
 *   }
 *   // return false if all-else fails
 *   return false
 * }
 */

/*
 * node.preventEval = preventEval(node, nodes)
 * node.fileEval = fileEval(node, nodes)
 *
 * var fileEval = main.fileEval = function (node, nodes) {
 *   // get the index for the node
 *   var index = indexOf(nodes, node)
 *   // split the nodes get all between last fence and this node
 *   var subNodes = slice(nodes, node.previousFenceIndex, index)
 *   // map loop / find
 *   var text = chain(subNodes).map(function (node) {
 *     return map(node.children, function (child) {
 *       return map(child, function (piece) {
 *         if (piece.type !== 'text') return false
 *         return piece.content.match(/\[(.+?)\]\(#?(eval\s?file|file\s?eval)\)/i)
 *       })
 *     })
 *   }).flattenDeep().without(false).value()
 *   // return file if match has been made
 *   if (text && text[1]) {
 *     return text[1]
 *   }
 *   // get the href value
 *   var href = chain(subNodes).map(function (node) {
 *     return find(node.children, function (child) {
 *       return find(child, function (piece) {
 *         if (piece.type !== 'link_open') return false
 *         if (!piece.attrs) return false
 *         var hrefIndex = piece.attrIndex('href')
 *         var hrefValue = piece.attrs[hrefIndex][1]
 *         return hrefValue.match(/(eval\s?file|file\s?eval)/i)
 *       })
 *     })
 *   }).flattenDeep().without(false).value()
 *   // if heref get the text of the href
 *   if (href) {
 *     var hrefText = find(href, {
 *       'type': 'text'
 *     })
 *     if (hrefText && hrefText.content) {
 *       return hrefText.content
 *     }
 *   }
 *   // check first line for comment declaration
 *   var commentMatch = node.content.match(/\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
 *   // if there's a first-line comment match return the value
 *   if (commentMatch && commentMatch[2]) {
 *     return commentMatch[2]
 *   }
 *   // return false if all-else fails
 *   return false
 * }
 */

/*
 *
 * var searchLink = main.searchLink = function (subNodes, pattern) {
 *   // console.log(subNodes)
 *   var href = chain(subNodes).map(function (node) {
 *     return find(node.children, function (child) {
 *       return find(child, function (piece) {
 *         if (piece.type !== 'link_open') return false
 *         if (!piece.attrs) return false
 *         var hrefIndex = piece.attrIndex('href')
 *         var hrefValue = piece.attrs[hrefIndex][1]
 *         return hrefValue.match(pattern)
 *       })
 *     })
 *   }).flattenDeep().without(false).value()
 *   // if heref get the text of the href
 *   if (href) {
 *     var hrefText = find(href, {
 *       'type': 'text'
 *     })
 *     if (hrefText && hrefText.content) {
 *       return hrefText.content
 *     } else if (hrefText) {
 *       return true
 *     }
 *   }
 *   return false
 * }
 */
