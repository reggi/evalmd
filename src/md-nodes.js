'use strict';

const crypto = require('crypto');
const {
  flatten, groupBy, range, values,
} = require('lodash');

/** @import { MdNode } from './types' */

/**
 * @param {MdNode} node
 * @param {readonly MdNode[]} nodes
 * @param {(node: MdNode) => unknown} fn
 */
function previousIndex(node, nodes, fn) {
  let index = nodes.indexOf(node);
  index = index < 0 ? 0 : index;
  const subArr = nodes.slice(0, index);
  const revIndex = subArr.reverse().findIndex(fn);
  if (revIndex < 0) { return 0; }
  return subArr.length - revIndex;
}

/**
 * @param {MdNode} node
 * @param {readonly MdNode[]} nodes
 * @param {string} type
 */
function previousIndexType(node, nodes, type) {
  return previousIndex(node, nodes, (n) => n.type === type);
}

/**
 * @param {MdNode} node
 * @param {readonly MdNode[]} nodes
 */
function previousIndexClose(node, nodes) {
  return previousIndex(node, nodes, (n) => n.type && n.type.match(/_close$/));
}

/** @param {readonly MdNode[]} nodes */
function groupChildren(nodes) {
  const grouped = groupBy(nodes, (node) => previousIndexClose(node, nodes));
  return values(grouped);
}

/**
 * @param {readonly MdNode[]} subNodes
 * @param {RegExp} pattern
 */
function searchLink(subNodes, pattern) {
  const textNode = subNodes.find((node) => {
    if (!node.content) { return false; }
    return node.content.match(pattern);
  });
  if (textNode) {
    const match = String(textNode.content || '').match(pattern);
    if (match && match[1]) { return match[1]; }
    if (match) { return true; }
  }
  return false;
}

/**
 * @param {MdNode} node
 * @param {RegExp} pattern
 */
function searchComment(node, pattern) {
  const commentMatch = String(node.content || '').match(pattern);
  if (commentMatch && commentMatch[2]) {
    return commentMatch[2];
  }
  if (commentMatch) {
    return true;
  }
  return false;
}

/** @param {number} lines */
function createLineDoc(lines) {
  return range(lines).map(() => '');
}

/**
 * @param {number | false | undefined} start
 * @param {string | string[]} main
 * @param {string | string[]} sub
 */
function replaceLines(start, main, sub) {
  const mainLines = Array.isArray(main) ? main : main.split('\n');
  const subLines = Array.isArray(sub) ? sub : sub.split('\n');
  return flatten([
    mainLines.slice(0, start || 0), subLines, mainLines.slice((start || 0) + subLines.length, mainLines.length),
  ]);
}

/** @param {string} content */
function getHash(content) {
  const shasum = crypto.createHash('md5');
  return shasum.update(content).digest('hex');
}

/** @param {readonly MdNode[]} nodes */
function mapNodes(nodes) {
  return nodes.map((node, index) => {
    node.previousFenceIndex = previousIndexType(node, nodes, 'fence');

    const subNodes = nodes.slice(node.previousFenceIndex, index);

    node.fileEval = searchLink(subNodes, /\[(.+)?\]\(#?(eval\s?file|file\s?eval)\)/i)
      || searchComment(node, /\/\/\s(file\s?eval\s|eval\s?file\s)(.+)/i)
      || false;

    node.preventEval = Boolean(searchLink(subNodes, /\[(.+)?\]\(#?(eval\s?prevent|prevent\s?eval)\)/i))
      || Boolean(searchComment(node, /\/\/\s(prevent\s?eval\s|eval\s?prevent\s)(.+)/i))
      || false;

    node.startLine = (node.map) ? node.map[0] + 1 : false;
    node.endLine = (node.map) ? node.map[1] - 1 : false;

    return node;
  });
}

/** @param {readonly MdNode[]} nodes */
function getNodeId(nodes) {
  return nodes.map((node, index) => {
    node.id = index + 1;
    return node;
  });
}

/**
 * @param {readonly MdNode[]} nodes
 * @param {string[]} langs
 */
function getFences(nodes, langs) {
  return nodes.filter((node) => {
    if (node.type !== 'fence') { return false; }
    if (!langs && node.type === 'fence') { return true; }
    const lang = String(node.info || '').trim().split(/\s+/)[0];
    return langs.indexOf(lang) !== -1;
  });
}

/** @param {readonly MdNode[]} nodes */
function filterPrevented(nodes) {
  return nodes.filter((node) => !node.preventEval);
}

/**
 * @param {MdNode | readonly MdNode[]} node$
 * @param {number} lines
 */
function buildPreserveLines(node$, lines) {
  const nodes = flatten([node$]);
  let lineDoc = createLineDoc(lines);
  nodes.forEach((node) => {
    const contentLines = String(node.content || '').split(/\r\n?|\n/);
    lineDoc = replaceLines(node.startLine, lineDoc, contentLines);
  });
  return lineDoc.join('\n');
}

/** @param {MdNode | readonly MdNode[]} node$ */
function buildConcat(node$) {
  const nodes = flatten([node$]);
  return nodes
    .map((node) => node.content)
    .join('');
}

module.exports = {
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
};
