'use strict';

const path = require('path');
const acorn = require('acorn');
const isCore = require('is-core-module');
const umd = require('./acorn-umd/acorn-umd.ts').default;
const { buildPreserveLines, buildConcat } = require('./md-nodes');

/** @import { Dep, EvalBuild, MdNode, Package, ParseOptions } from './types' */

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
 * @param {ParseOptions} [parseOpts]
 * @returns {readonly Dep[]}
 */
function getDeps(code, parseOpts) {
  const opts = parseOpts || {};
  const ast = opts.parse ? opts.parse(code) : acorn.parse(code, { sourceType: opts.sloppy ? 'script' : 'module', ecmaVersion: 6 });
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
 * @param {string} code
 * @param {string} _prepend
 * @param {Package | false} pkg
 * @param {ParseOptions} [parseOpts]
 */
function alterAssignedModule(code, _prepend, pkg, parseOpts) {
  if (!pkg) { return code; }
  const deps = getDeps(code, parseOpts);
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
 * @param {ParseOptions} [parseOpts]
 */
function alterSelfModules(code, nodes, parseOpts) {
  const deps = getDeps(code, parseOpts);
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
 * @param {ParseOptions} [parseOpts]
 */
function alterPrependModules(code, nodes, prepend, parseOpts) {
  const deps = getDeps(code, parseOpts);
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
 * @param {ParseOptions} [parseOpts]
 */
function alterNpmModules(code, _nodes, prepend, parseOpts) {
  const deps = getDeps(code, parseOpts);
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
 * @param {ParseOptions} [parseOpts]
 */
function alterModules(code, nodes, pkg, prepend, parseOpts) {
  /*
   * syntax errors will come through to here and
   * get thrown by the acorn parser
   */
  code = alterAssignedModule(code, prepend, pkg, parseOpts);
  code = alterSelfModules(code, nodes, parseOpts);
  code = alterPrependModules(code, nodes, prepend, parseOpts);
  code = alterNpmModules(code, nodes, prepend, parseOpts);
  return code;
}

/**
 * @param {MdNode | readonly MdNode[]} node
 * @param {readonly MdNode[]} nodes
 * @param {number} markdownLinesLength
 * @param {Package | false} pkg
 * @param {string} prepend
 * @param {ParseOptions} [parseOpts]
 * @returns {EvalBuild}
 */
function buildEvalable(node, nodes, markdownLinesLength, pkg, prepend, parseOpts) {
  const preserve = buildPreserveLines(node, markdownLinesLength);
  const concat = buildConcat(node);
  // if there is an error have preserve run first to return line number
  const preserveAlter = alterModules(preserve, nodes, pkg, prepend, parseOpts);
  const concatAlter = alterModules(concat, nodes, pkg, prepend, parseOpts);
  return {
    preserve,
    concat,
    preserveAlter,
    concatAlter,
  };
}

module.exports = {
  replacePosition,
  toRequirePath,
  regExpEscape,
  getDeps,
  alterAssignedModule,
  alterSelfModules,
  alterPrependModules,
  alterNpmModules,
  alterModules,
  buildEvalable,
};
