'use strict';

const osTmpDir = require('os-tmpdir');
const path = require('path');
const childProcess = require('child_process');
const { flatten } = require('lodash');
const promisify = require('util.promisify');
const nodeFs = require('fs');
const mkdirp = require('mkdirp');
const MarkdownIt = require('markdown-it');
const acorn = require('acorn');
const umd = require('./acorn-umd/acorn-umd').default;
const promiseRipple = require('./promise-ripple');
const promiseSeries = require('./promise-series');
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
  runPromptCommand,
  checkPromptCommand,
} = require('./shell-eval');
// var _eval = require('eval')
const isCore = require('is-core-module');
const temp = path.join(osTmpDir(), 'evalmd');

const fs = {
  readFileAsync: promisify(nodeFs.readFile),
  mkdirsAsync: promisify(mkdirp),
  writeFileAsync: promisify(nodeFs.writeFile),
  unlinkAsync: promisify(nodeFs.unlink),
};

/** @import { AssembleData, ConcatNode, Dep, EvalBuild, MdNode, Package } from './types' */

let logger = createLogger({ silence: true });
let SLOPPY = false;
/** @type {((code: string) => any) | false} */
let CURRENT_PARSE = false;

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
 * @param {string} code
 * @returns {readonly Dep[]}
 */
function getDeps(code) {
  // eslint-disable-next-line new-cap
  const ast = CURRENT_PARSE ? CURRENT_PARSE(code) : acorn.parse(code, { sourceType: SLOPPY ? 'script' : 'module', ecmaVersion: 6 });
  const deps = umd(ast, {
    es6: true, amd: true, cjs: true,
  });
  return Array.from(new Set(deps)).map((dep) => {
    const source = dep.source;
    return {
      source: {
        value: String(source && 'value' in source ? source.value : ''),
        start: source ? source.start : 0,
        end: source ? source.end : 0,
      },
    };
  });
}

/**
 * @param {string} str
 * @param {number} start
 * @param {number} end
 * @param {string} value
 */
function replacePosition(str, start, end, value) {
  return str.substr(0, start) + value + str.substr(end);
}

/** @param {string} replacement */
function toRequirePath(replacement) {
  return replacement.split(path.sep).join('/');
}

/** @param {string} s */
function regExpEscape(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * @param {string} code
 * @param {string} _prepend
 * @param {Package | false} pkg
 */
function alterAssignedModule(code, _prepend, pkg) {
  if (!pkg) { return code; }
  const deps = getDeps(code);
  if (!deps.length) { return code; }
  let name = pkg.name;
  let chars = 0;
  name = regExpEscape(name);
  const pattern = new RegExp(`^${name}($|/.*)`);
  deps.forEach((dep) => {
    const match = dep.source.value.match(pattern);
    if (match) {
      const start = chars + dep.source.start + 1;
      const end = chars + dep.source.end - 1;
      const absModule = path.dirname(path.resolve(pkg.path));
      const replacement = toRequirePath(match[1] ? path.join(absModule, match[1]) : absModule);
      code = replacePosition(code, start, end, replacement);
      chars += replacement.length - dep.source.value.length;
    }
  });
  return code;
}

/**
 * @param {string} code
 * @param {readonly MdNode[]} nodes
 */
function alterSelfModules(code, nodes) {
  const deps = getDeps(code);
  if (!deps.length) { return code; }
  let chars = 0;
  deps.forEach((dep) => {
    if (dep.source.value) {
      const node = nodes.find((node) => node.fileEval === dep.source.value);
      if (node && node.fileCreated) {
        const start = chars + dep.source.start + 1;
        const end = chars + dep.source.end - 1;
        const replacement = toRequirePath(node.fileEvalHashPath);
        code = replacePosition(code, start, end, replacement);
        chars += replacement.length - dep.source.value.length;
      }
    }
  });
  return code;
}

/**
 * @param {string} code
 * @param {readonly MdNode[]} nodes
 * @param {string} prepend
 */
function alterPrependModules(code, nodes, prepend) {
  const deps = getDeps(code);
  if (!deps.length) { return code; }
  prepend = (prepend) ? prepend : './';
  const localRegex = /^.\.\/|^.\//;
  let chars = 0;
  deps.forEach((dep) => {
    if (dep.source.value && dep.source.value.match(localRegex)) {
      const node = nodes.find((node) => node.fileEval === dep.source.value);
      if (!node) {
        const start = chars + dep.source.start + 1;
        const end = chars + dep.source.end - 1;
        const replacement = toRequirePath(path.resolve(path.join(prepend, dep.source.value)));
        code = replacePosition(code, start, end, replacement);
        chars += replacement.length - dep.source.value.length;
      }
    }
  });
  return code;
}

/**
 * @param {string} code
 * @param {readonly MdNode[]} _nodes
 * @param {string} prepend
 */
function alterNpmModules(code, _nodes, prepend) {
  const deps = getDeps(code);
  if (!deps.length) { return code; }
  prepend = (prepend) ? prepend : './';
  const nonNpm = /^.\.\/|^.\/|^\//;
  let chars = 0;
  deps.forEach((dep) => {
    if (dep.source.value && !dep.source.value.match(nonNpm) && !isCore(dep.source.value) && !path.isAbsolute(dep.source.value)) {
      const start = chars + dep.source.start + 1;
      const end = chars + dep.source.end - 1;
      const replacement = toRequirePath(path.resolve(path.join(prepend, 'node_modules', dep.source.value)));
      code = replacePosition(code, start, end, replacement);
      chars += replacement.length - dep.source.value.length;
    }
  });
  return code;
}

/**
 * @param {string} code
 * @param {readonly MdNode[]} nodes
 * @param {Package | false} pkg
 * @param {string} prepend
 */
function alterModules(code, nodes, pkg, prepend) {
  /*
   * syntax errors will come through to here and
   * get thrown by the acorn parser
   */
  code = alterAssignedModule(code, prepend, pkg);
  code = alterSelfModules(code, nodes);
  code = alterPrependModules(code, nodes, prepend);
  code = alterNpmModules(code, nodes, prepend);
  return code;
}

/**
 * @param {MdNode | readonly MdNode[]} node
 * @param {readonly MdNode[]} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @returns {EvalBuild}
 */
function buildEvalable(node, nodes, markdownLinesLength, pkg, prepend) {
  const preserve = buildPreserveLines(node, markdownLinesLength);
  const concat = buildConcat(node);
  // if there is an error have preserve run first to return line number
  const preserveAlter = alterModules(preserve, nodes, pkg, prepend);
  const concatAlter = alterModules(concat, nodes, pkg, prepend);
  return {
    preserve,
    concat,
    preserveAlter,
    concatAlter,
  };
}

/** @param {...any} args */
function logInfo(...args) {
  return logger.info(...args);
}

/** @param {...any} args */
function logDebug(...args) {
  return logger.debug(...args);
}

/** @param {unknown} err */
function logErr(err) {
  return logger.err(err);
}

/**
 * @param {string} filePath
 * @param {readonly MdNode[]} nodes
 */
function evalError(filePath, nodes) {
  return /** @param {unknown} e */ function (e) {
    if (!(e instanceof Error) || !e.stack) { return e; }
    const stack = stackSplit(e.stack);
    const absFilePath = path.resolve(filePath);
    const cleanLines = getCleanLines(stack.lines, nodes, absFilePath, false);
    if (cleanLines.length !== 0) { stack.lines = cleanLines; }
    stack.frame = getCleanLines(stack.frame, nodes, absFilePath, true);
    stack.frame.shift();
    if (stack.frame[stack.frame.length - 1] === '') { stack.frame.pop(); }
    return stackJoin(stack);
  };
}

/** @param {string} file */
function evalFileAsync(file) {
  return new Promise((resolve, reject) => {
    const command = [process.execPath, file].join(' ');
    childProcess.exec(command, (error, stdout, stderr) => {
      if (stdout) { process.stdout.write(stdout); }
      if (error) { return reject(error); }
      return resolve({
        stdout,
        stderr,
      });
    });
  });
}

/**
 * @param {unknown} error
 * @param {((e: unknown) => unknown) | undefined} [stackWrapper]
 */
function getCleanErr(error, stackWrapper) {
  if (stackWrapper) { return stackWrapper(error); }
  if (error instanceof Error && error.stack) { return error.stack; }
  return error;
}

/**
 * @param {unknown} error
 * @param {((e: unknown) => unknown) | undefined} stackWrapper
 * @param {boolean} nonstop
 */
function nonstopErr(error, stackWrapper, nonstop) {
  const cleanErr = getCleanErr(error, stackWrapper);
  if (nonstop) {
    logErr(cleanErr);
    return error;
  }
  throw cleanErr;

}

/**
 * @template {MdNode | ConcatNode} T
 * @param {T} node
 * @param {readonly MdNode[]} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 * @returns {Promise<T>}
 */
function evaluate(
  node,
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath
) {
  return promiseRipple(node, {
    notice(node) {
      const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
      const word = (ids.length > 1) ? 'blocks' : 'block';
      logInfo(filePath, [
        'running', word, ids.join(', '),
      ].join(' '));
    },
    evalCode(node) {
      CURRENT_PARSE = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
      const stackWrapper = acornError(nodes, filePath);
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend);
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop);
      }
    },
    fileName(node) {
      const fileEvalHash = typeof node.fileEval === 'string' ? getHash(node.fileEval) : getHash(filePath + node.id);
      Object.assign(node, {
        fileEvalHash,
        fileEvalHashPath: path.join(temp, `${fileEvalHash}.js`),
      });
      return node;
    },
    fileCreated(node) {
      if (!node.evalCode || node.evalCode instanceof Error || !node.fileEvalHashPath) { return false; }
      const evalCode = node.evalCode;
      const fileEvalHashPath = node.fileEvalHashPath;
      const dirs = path.dirname(fileEvalHashPath);
      return fs.mkdirsAsync(dirs)
        .then(() => fs.writeFileAsync(fileEvalHashPath, evalCode.preserveAlter)
          .then(() => true));
    },
    evalResult(node) {
      if (!node.fileCreated || !node.fileEvalHashPath) { return false; }
      const stackWrapper = evalError(filePath, nodes);
      return evalFileAsync(node.fileEvalHashPath)
        .catch((error) => nonstopErr(error, stackWrapper, nonstop));
    },
    fileRemove(node) {
      if (!node.fileCreated || !node.fileEvalHashPath) { return false; }
      return fs.unlinkAsync(node.fileEvalHashPath);
    },
  });
}

/**
 * @param {ConcatNode} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 * @param {boolean} blockScope
 */
function evaluateScope(
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  blockScope
) {
  if (blockScope) {
    return promiseSeries(nodes, (node, _index, nodes) => evaluate(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath));
  }
  return evaluate(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath)
    .then((node) => [node]);

}

/**
 * @template {MdNode | ConcatNode} T
 * @param {T} node
 * @param {readonly MdNode[]} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 * @param {string | boolean} output
 * @param {string | boolean} delimeter
 * @returns {Promise<T>}
 */
function outputCode(
  node,
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  output,
  delimeter
) {
  return promiseRipple(node, {
    notice(node) {
      const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
      const word = (ids.length > 1) ? 'blocks' : 'block';
      logInfo(filePath, [
        'outputting', word, ids.join(', '),
      ].join(' '));
    },
    evalCode(node) {
      CURRENT_PARSE = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
      const stackWrapper = acornError(nodes, filePath);
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend);
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop);
      }
    },
    output(node) {
      if (!node.evalCode || node.evalCode instanceof Error) { return false; }
      if (output === true) { output = 'preserve'; }
      if (output === 'preserve' || output === 'concat' || output === 'preserveAlter' || output === 'concatAlter') {
        process.stdout.write(node.evalCode[output]);
      }
      delimeter = (delimeter === true) ? '//EVALMD-STDOUT-FILE-DELIMETER' : delimeter;
      if (delimeter) { process.stdout.write(delimeter); }
      return true;
    },
  });
}

/**
 * @param {ConcatNode} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 * @param {boolean} blockScope
 * @param {string | boolean} output
 * @param {string | boolean} delimeter
 */
function outputScope(
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  blockScope,
  output,
  delimeter
) {
  if (blockScope) {
    return promiseSeries(nodes, (node, _index, nodes) => outputCode(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter));
  }
  return outputCode(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter)
    .then((node) => [node]);

}

/**
 * @param {readonly MdNode[]} nodes
 * @param {string} filePath
 * @param {boolean} nonstop
 */
function evaluateShell(nodes, filePath, nonstop) {
  return promiseSeries(nodes, (node) => {
    logInfo(filePath, [
      'running', 'block', node.id,
    ].join(' '));
    const commands = parsePromptBlock(node.content);
    return promiseSeries(commands, (item) => runPromptCommand(item.command).then((result) => {
      const error = checkPromptCommand(item, result);
      if (error) {
        if (!nonstop) { throw error; }
        logErr(error);
        node.evalResult = error;
      }
      return result;
    }))
      .then(() => {
        if (!node.evalResult) { node.evalResult = true; }
        return node;
      });
  });
}

/**
 * @param {string} kind
 * @param {readonly MdNode[]} nodes
 * @param {string} filePath
 * @param {boolean} nonstop
 */
function evaluateKind(kind, nodes, filePath, nonstop) {
  if (kind === 'sh') { return evaluateShell(nodes, filePath, nonstop); }
  return Promise.resolve([]);
}

/**
 * @param {AssembleData} data
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 */
function evaluateAllKinds(data, pkg, prepend, nonstop, filePath) {
  /** @type {(() => unknown)[]} */
  const runners = [];
  const evalNodes = data.evalNodes || [];
  const markdownLinesLength = (data.markdownLines || []).length;
  const kindFences = data.kindFences || {};
  if (evalNodes.length) {
    runners.push(() => evaluateScope(evalNodes, markdownLinesLength, pkg, prepend, nonstop, filePath, Boolean(data.blockScope)));
  }
  Object.keys(kindFences).forEach((kind) => {
    if (kindFences[kind].length) {
      runners.push(() => evaluateKind(kind, kindFences[kind], filePath, nonstop));
    }
  });
  if (!runners.length) {
    logInfo('no blocks to eval');
    return Promise.resolve(false);
  }
  /** @type {unknown[]} */
  let results = [];
  return runners.reduce((chain, runner) => chain.then(() => Promise.resolve(runner()).then((nodes) => {
    results = results.concat(nodes);
  })), Promise.resolve()).then(() => results);
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
 * @returns {Promise<AssembleData>}
 */
function assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter, evalLangs, useEslint) {
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
        logInfo('eval prevented');
        return false;
      }
      return evaluateAllKinds(data, pkg, prepend, nonstop, filePath);
    },
    /** @param {AssembleData} data */
    outputed(data) {
      if (!output) {
        return false;
      }
      if (!data.evalNodes || !data.markdownLines) { return false; }
      return outputScope(data.evalNodes, data.markdownLines.length, pkg, prepend, nonstop, filePath, Boolean(data.blockScope), output, delimeter);
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
  SLOPPY = sloppy;
  logger = createLogger({ debug, silence });
  const filePaths = flatten([filePath$]);
  logInfo('it worked if it ends with', 'ok');
  return getPackage(packagePath)
    .then((pkg) => Promise.all(filePaths.map((filePath) => assemble(filePath, pkg, prepend, blockScope, nonstop, preventEval, includePrevented, output, delimeter, evalLangs, useEslint))))
    .then((mdResults) => {
    // console.log(mdResults)
      const exitCode = getExitCode(mdResults);
      if (exitCode === 0) { logInfo('ok'); }
      logDebug('exit code', exitCode);
      return {
        dataSets: mdResults,
        exitCode,
        log: logger.store,
      };
    })
    .catch((error) => {
      logErr(error);
      const exitCode = 1;
      logDebug('exit code', exitCode);
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
module.exports.logErr = logErr;
module.exports.logInfo = logInfo;
module.exports.logDebug = logDebug;
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
