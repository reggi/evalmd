'use strict';

const osTmpDir = require('os-tmpdir');
const path = require('path');
const childProcess = require('child_process');
const promisify = require('util.promisify');
const nodeFs = require('fs');
const mkdirp = require('mkdirp');
const promiseRipple = require('./promise-ripple');
const promiseSeries = require('./promise-series');
const {
  stackSplit,
  stackJoin,
  acornError,
  getCleanLines,
} = require('./eval-errors');
const { buildEvalable } = require('./module-rewrite');
const { getHash } = require('./md-nodes');
const {
  parsePromptBlock,
  runPromptCommand,
  checkPromptCommand,
} = require('./shell-eval');

const temp = path.join(osTmpDir(), 'evalmd');

const fs = {
  mkdirsAsync: promisify(mkdirp),
  writeFileAsync: promisify(nodeFs.writeFile),
  unlinkAsync: promisify(nodeFs.unlink),
};

/** @import { AssembleData, ConcatNode, Logger, MdNode, Package } from './types' */

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
 * @param {Logger} logger
 */
function nonstopErr(error, stackWrapper, nonstop, logger) {
  const cleanErr = getCleanErr(error, stackWrapper);
  if (nonstop) {
    logger.err(cleanErr);
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
 * @param {Logger} logger
 * @param {boolean} sloppy
 * @returns {Promise<T>}
 */
function evaluate(
  node,
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  logger,
  sloppy
) {
  return promiseRipple(node, {
    notice(node) {
      const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
      const word = (ids.length > 1) ? 'blocks' : 'block';
      logger.info(filePath, [
        'running', word, ids.join(', '),
      ].join(' '));
    },
    evalCode(node) {
      const parse = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
      const stackWrapper = acornError(nodes, filePath);
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend, { parse, sloppy });
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop, logger);
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
        .catch((error) => nonstopErr(error, stackWrapper, nonstop, logger));
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
 * @param {Logger} logger
 * @param {boolean} sloppy
 */
function evaluateScope(
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  blockScope,
  logger,
  sloppy
) {
  if (blockScope) {
    return promiseSeries(nodes, (node, _index, nodes) => evaluate(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, logger, sloppy));
  }
  return evaluate(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, logger, sloppy)
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
 * @param {Logger} logger
 * @param {boolean} sloppy
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
  delimeter,
  logger,
  sloppy
) {
  return promiseRipple(node, {
    notice(node) {
      const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
      const word = (ids.length > 1) ? 'blocks' : 'block';
      logger.info(filePath, [
        'outputting', word, ids.join(', '),
      ].join(' '));
    },
    evalCode(node) {
      const parse = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
      const stackWrapper = acornError(nodes, filePath);
      try {
        return buildEvalable(node, nodes, markdownLinesLength, pkg, prepend, { parse, sloppy });
      } catch (error) {
        return nonstopErr(error, stackWrapper, nonstop, logger);
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
 * @param {Logger} logger
 * @param {boolean} sloppy
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
  delimeter,
  logger,
  sloppy
) {
  if (blockScope) {
    return promiseSeries(nodes, (node, _index, nodes) => outputCode(node, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter, logger, sloppy));
  }
  return outputCode(nodes, nodes, markdownLinesLength, pkg, prepend, nonstop, filePath, output, delimeter, logger, sloppy)
    .then((node) => [node]);

}

/**
 * @param {readonly MdNode[]} nodes
 * @param {string} filePath
 * @param {boolean} nonstop
 * @param {Logger} logger
 */
function evaluateShell(nodes, filePath, nonstop, logger) {
  return promiseSeries(nodes, (node) => {
    logger.info(filePath, [
      'running', 'block', node.id,
    ].join(' '));
    const commands = parsePromptBlock(node.content);
    return promiseSeries(commands, (item) => runPromptCommand(item.command).then((result) => {
      const error = checkPromptCommand(item, result);
      if (error) {
        if (!nonstop) { throw error; }
        logger.err(error);
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
 * @param {Logger} logger
 */
function evaluateKind(kind, nodes, filePath, nonstop, logger) {
  if (kind === 'sh') { return evaluateShell(nodes, filePath, nonstop, logger); }
  return Promise.resolve([]);
}

/**
 * @param {AssembleData} data
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {boolean} nonstop
 * @param {string} filePath
 * @param {Logger} logger
 * @param {boolean} sloppy
 */
function evaluateAllKinds(data, pkg, prepend, nonstop, filePath, logger, sloppy) {
  /** @type {(() => unknown)[]} */
  const runners = [];
  const evalNodes = data.evalNodes || [];
  const markdownLinesLength = (data.markdownLines || []).length;
  const kindFences = data.kindFences || {};
  if (evalNodes.length) {
    runners.push(() => evaluateScope(evalNodes, markdownLinesLength, pkg, prepend, nonstop, filePath, Boolean(data.blockScope), logger, sloppy));
  }
  Object.keys(kindFences).forEach((kind) => {
    if (kindFences[kind].length) {
      runners.push(() => evaluateKind(kind, kindFences[kind], filePath, nonstop, logger));
    }
  });
  if (!runners.length) {
    logger.info('no blocks to eval');
    return Promise.resolve(false);
  }
  /** @type {unknown[]} */
  let results = [];
  return runners.reduce((chain, runner) => chain.then(() => Promise.resolve(runner()).then((nodes) => {
    results = results.concat(nodes);
  })), Promise.resolve()).then(() => results);
}

module.exports = {
  evalError,
  evalFileAsync,
  getCleanErr,
  nonstopErr,
  evaluate,
  evaluateScope,
  outputCode,
  outputScope,
  evaluateShell,
  evaluateKind,
  evaluateAllKinds,
};
