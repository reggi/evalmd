'use strict';

const path = require('path');

/** @import { ConcatNode, MdNode, StackBuckets } from './types' */

/** @param {string} stack */
function stackSplit(stack) {
  const pattern = /^\s\s\s\sat\s/;
  const stackLines = stack.split('\n');
  return {
    frame: stackLines.filter((stackLine) => !pattern.test(stackLine)),
    lines: stackLines.filter((stackLine) => pattern.test(stackLine)),
  };
}

/**
 * join the stack frame with the lines
 * @param {StackBuckets} stack
 */
function stackJoin(stack) {
  return [
    stack.frame.join('\n'),
    stack.lines.join('\n'),
  ].join('\n');
}

/**
 * @param {readonly MdNode[]} nodes
 * @param {number | undefined} line
 */
function findErrorNode(nodes, line) {
  return nodes.find((node) => Number(node.startLine) <= Number(line) && Number(node.endLine) >= Number(line));
}

/**
 * @param {unknown} e
 * @returns {e is Error & { loc: { line: number, column: number } }}
 */
const isAcornError = function (e) {
  return e instanceof Error
    && 'loc' in e
    && typeof e.loc === 'object' && e.loc !== null
    && 'line' in e.loc && typeof e.loc.line === 'number'
    && 'column' in e.loc && typeof e.loc.column === 'number';
};

/**
 * @param {readonly MdNode[]} nodes
 * @param {string} filePath
 */
function acornError(nodes, filePath) {
  return /** @param {unknown} e */ function (e) {
    if (!isAcornError(e) || !e.stack || !e.loc) { return e; }
    const stack = stackSplit(e.stack);
    const lineChar = [
      e.loc.line, ':', e.loc.column,
    ].join('');
    const errorNode = findErrorNode(nodes, e.loc.line);
    const absFilePath = path.resolve(filePath);
    const line = [
      '    at ', absFilePath, ':', lineChar, errorNode ? ` {block ${errorNode.id}}` : '',
    ].join('');
    stack.lines = [line];
    return stackJoin(stack);
  };
}

/** @param {string | Error} s */
function parseLineChar(s) {
  const str = s instanceof Error ? s.message : s;
  const patternLineChar = /:(\d+):(\d+)/;
  const patternLine = /:(\d+)/;

  const matchLineChar = str.match(patternLineChar);
  if (matchLineChar) {
    return {
      lineChar: matchLineChar[0],
      line: parseInt(matchLineChar[1], 10),
      char: parseInt(matchLineChar[2], 10),
    };
  }
  const matchLine = str.match(patternLine);
  if (matchLine) {
    return {
      lineChar: parseInt(matchLine[1], 10),
      line: parseInt(matchLine[1], 10),
      char: false,
    };
  }
  return false;
}

/**
 * @param {string[]} incLines
 * @param {ConcatNode} nodes
 * @param {string} absFilePath
 * @param {boolean} frame
 */
function getCleanLines(incLines, nodes, absFilePath, frame) {
  let lines = incLines.map((line) => {
    const lineChar = parseLineChar(line);
    const matchNodes = nodes.find((node) => {
      if (!node.fileEvalHashPath) { return false; }
      return line.match(node.fileEvalHashPath);
    });
    const matchNode = (function () {
      if (!nodes.fileEvalHashPath) { return false; }
      const match = line.match(nodes.fileEvalHashPath);
      if (!match) { return false; }
      const errorNode = findErrorNode(nodes, lineChar ? lineChar.line : undefined);
      return {
        id: errorNode && errorNode.id ? errorNode.id : nodes.id,
        fileEval: nodes.fileEval,
      };
    }());
    const match = matchNodes || matchNode || false;

    /** @type {string | false} */
    let replacement = false;
    if (match) {
      replacement = '';
      if (!frame) { replacement += '    at '; }
      replacement += absFilePath;
      if (lineChar && lineChar.line && lineChar.char) { replacement += `:${lineChar.line}:${lineChar.char}`; }
      if (lineChar && lineChar.line && !lineChar.char) { replacement += `:${lineChar.line}`; }
      if (match.id && !match.fileEval) { replacement += ` {block ${match.id}}`; }
      if (match.id && match.fileEval) { replacement += ` {block ${match.id} (${match.fileEval})}`; }
    }
    return {
      line,
      replacement,
    };
  });
  lines = lines.reverse();
  let matchFound = false;
  if (!frame) {
    lines = lines.filter((line) => {
      if (line.replacement) { matchFound = true; }
      return matchFound;
    });
  }
  const cleanLines = lines.map((line) => {
    if (typeof line.replacement === 'string') { return line.replacement; }
    return line.line;
  });
  return cleanLines.reverse();
}

module.exports = {
  stackSplit,
  stackJoin,
  findErrorNode,
  isAcornError,
  acornError,
  parseLineChar,
  getCleanLines,
};
