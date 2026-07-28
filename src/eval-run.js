'use strict';

const path = require('path');
const childProcess = require('child_process');

const tmp = require('tmp');
const assign = require('object.assign');

const {
  mkdir,
  writeFile,
  unlink,
} = require('fs/promises');
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

const temp = path.join(tmp.tmpdir, 'evalmd');

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
async function evaluate(
  node,
  nodes,
  markdownLinesLength,
  pkg,
  prepend,
  nonstop,
  filePath,
  logger,
  sloppy,
) {
  const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
  logger.info(filePath, [
    'running',
    ids.length > 1 ? 'blocks' : 'block',
    ids.join(', '),
  ].join(' '));

  const parse = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
  const buildStackWrapper = acornError(nodes, filePath);
  try {
    node.evalCode = buildEvalable(node, nodes, markdownLinesLength, pkg, prepend, { parse, sloppy });
  } catch (error) {
    node.evalCode = /** @type {Error} */ (nonstopErr(error, buildStackWrapper, nonstop, logger));
  }

  const fileEvalHash = typeof node.fileEval === 'string' ? getHash(node.fileEval) : getHash(filePath + node.id);
  assign(node, {
    fileEvalHash,
    fileEvalHashPath: path.join(temp, `${fileEvalHash}.js`),
  });

  const { evalCode, fileEvalHashPath } = node;
  if (evalCode && !(evalCode instanceof Error) && fileEvalHashPath) {
    await mkdir(path.dirname(fileEvalHashPath), { recursive: true });
    await writeFile(fileEvalHashPath, evalCode.preserveAlter);
    node.fileCreated = true;
  } else {
    node.fileCreated = false;
  }

  if (node.fileCreated && node.fileEvalHashPath) {
    const evalStackWrapper = evalError(filePath, nodes);
    node.evalResult = await evalFileAsync(node.fileEvalHashPath)
      .catch((error) => nonstopErr(error, evalStackWrapper, nonstop, logger));
    await unlink(node.fileEvalHashPath);
  } else {
    node.evalResult = false;
  }

  return node;
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
  sloppy,
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
async function outputCode(
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
  sloppy,
) {
  const ids = Array.isArray(node) ? node.map((n) => n.id) : [node.id];
  logger.info(filePath, [
    'outputting',
    ids.length > 1 ? 'blocks' : 'block',
    ids.join(', '),
  ].join(' '));

  const parse = (Array.isArray(node) ? (node[0] && node[0].parse) : node.parse) || false;
  const stackWrapper = acornError(nodes, filePath);
  try {
    node.evalCode = buildEvalable(node, nodes, markdownLinesLength, pkg, prepend, { parse, sloppy });
  } catch (error) {
    node.evalCode = /** @type {Error} */ (nonstopErr(error, stackWrapper, nonstop, logger));
  }

  const { evalCode } = node;
  if (evalCode && !(evalCode instanceof Error)) {
    if (output === true) { output = 'preserve'; }
    if (output === 'preserve' || output === 'concat' || output === 'preserveAlter' || output === 'concatAlter') {
      process.stdout.write(evalCode[output]);
    }
    if (delimeter === true) {
      delimeter = '//EVALMD-STDOUT-FILE-DELIMETER';
    }
    if (delimeter) { process.stdout.write(delimeter); }
  }

  return node;
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
  sloppy,
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
async function evaluateKind(kind, nodes, filePath, nonstop, logger) {
  if (kind === 'sh') { return evaluateShell(nodes, filePath, nonstop, logger); }
  return [];
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
async function evaluateAllKinds(
  data,
  pkg,
  prepend,
  nonstop,
  filePath,
  logger,
  sloppy,
) {
  /** @typedef {Awaited<ReturnType<typeof evaluateScope> | ReturnType<typeof evaluateKind>>} RunnerResults */
  /** @typedef {RunnerResults[number]} RunnerResult */
  /** @type {(() => Promise<RunnerResults>)[]} */
  const runners = [];
  const evalNodes = data.evalNodes || [];
  const markdownLinesLength = (data.markdownLines || []).length;
  if (evalNodes.length >= 0) {
    runners[runners.length] = () => evaluateScope(
      evalNodes,
      markdownLinesLength,
      pkg,
      prepend,
      nonstop,
      filePath,
      !!data.blockScope,
      logger,
      sloppy,
    );
  }
  if (data.kindFences) {
    const { kindFences } = data;
    Object.keys(kindFences).forEach((kind) => {
      const fences = kindFences[kind];
      if (fences?.length) {
        runners[runners.length] = () => evaluateKind(
          kind,
          fences,
          filePath,
          nonstop,
          logger,
        );
      }
    });
  }
  if (!runners.length) {
    logger.info('no blocks to eval');
    return false;
  }
  return runners.reduce(async (prev, runner) => {
    const [results, nodes] = await Promise.all([prev, runner()]);
    return /** @type {RunnerResult[]} */ ([]).concat(results, nodes);
  }, Promise.resolve(/** @type {RunnerResult[]} */ ([])));
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
