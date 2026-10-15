'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const acorn = require('acorn');
const resolveSync = require('resolve/sync');
const estraverse = require('estraverse');
const isCore = require('is-core-module');
const { buildPreserveLines, buildConcat } = require('./md-nodes');

/**
 * @import {
 *  Dep,
 *  EsExpressionStatement,
 *  EsNode,
 *  EvalBuild,
 *  MdNode,
 *  Package,
 *  ParseOptions,
 * } from './types'
 */
/** @import { Node } from 'estree' */

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
 */
function parseCode(code, parseOpts) {
  const opts = parseOpts || {};
  return opts.parse ? opts.parse(code) : acorn.parse(code, { sourceType: opts.sloppy ? 'script' : 'module', ecmaVersion: 6 });
}

/**
 * @param {string} code
 * @param {ParseOptions} [parseOpts]
 * @returns {readonly Dep[]}
 */
function getDeps(code, parseOpts) {
  const ast = parseCode(code, parseOpts);
  /** @type {Dep[]} */
  const deps = [];
  /**
   * @param {EsNode | undefined} source
   * @param {Dep['moduleSystem']} moduleSystem
   */
  function pushSource(source, moduleSystem) {
    deps[deps.length] = {
      moduleSystem,
      source: {
        value: String(source && 'value' in source ? source.value : ''),
        start: source?.start ?? 0,
        end: source?.end ?? 0,
      },
    };
  }
  estraverse.traverse(/** @type {Node} */ (ast), {
    fallback: 'iteration',
    enter(node) {
      const esNode = /** @type {EsNode} */ (node);
      if (esNode.type === 'ImportDeclaration') {
        pushSource(esNode.source, 'import');
      } else if (
        esNode.type === 'CallExpression'
        && esNode.callee?.type === 'Identifier'
        && esNode.callee.name === 'require'
        && esNode.arguments?.length
      ) {
        pushSource(esNode.arguments[0], 'require');
      }
    },
  });
  return deps.sort((a, b) => a.source.start - b.source.start);
}

/**
 * @param {Dep} dep
 * @param {string} subpath
 * @param {Package} pkg
 * @param {string} absModule
 */
function resolveAssignedModule(dep, subpath, pkg, absModule) {
  if (typeof pkg.exports === 'undefined') {
    return toRequirePath(subpath ? path.join(absModule, subpath) : absModule);
  }
  // resolve the self-reference through `exports`, as the current `node` that evaluates the block will
  const resolved = resolveSync(dep.source.value, {
    basedir: absModule,
    engines: process.versions.node,
    // @ts-expect-error `resolve`'s types omit its `moduleSystem` option
    moduleSystem: dep.moduleSystem,
  });
  // an absolute path is not a valid `import` specifier on Windows
  return dep.moduleSystem === 'import' ? pathToFileURL(resolved).href : toRequirePath(resolved);
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
  const name = regExpEscape(pkg.name);
  const pattern = new RegExp(`^${name}($|/.*)`);
  let chars = 0;
  deps.forEach((dep) => {
    const match = dep.source.value.match(pattern);
    if (match) {
      const start = chars + dep.source.start + 1;
      const end = chars + dep.source.end - 1;
      const absModule = path.dirname(path.resolve(pkg.path));
      const replacement = resolveAssignedModule(dep, match[1], pkg, absModule);
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
  prepend ||= './';
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
  prepend ||= './';
  const nonNpm = /^.\.\/|^.\/|^\/|^file:/;
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

const throwsComment = /^[ \t]*\/\/[ \t]*throws\b/i;

const functionTypes = [
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
];

/** @param {EsNode} node */
function hasTopLevelAwait(node) {
  let found = false;
  estraverse.traverse(/** @type {Node} */ (node), {
    fallback: 'iteration',
    enter(child) {
      if (functionTypes.indexOf(child.type) !== -1) {
        return estraverse.VisitorOption.Skip;
      }
      if (child.type === 'AwaitExpression') {
        found = true;
        return estraverse.VisitorOption.Break;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * @param {string} code
 * @param {ParseOptions} [parseOpts]
 */
function alterExpectedThrows(code, parseOpts) {
  /** @type {(statement: EsNode) => statement is EsExpressionStatement} */
  const isExpectedThrow = (statement) => {
    if (statement.type !== 'ExpressionStatement') { return false; }
    const end = statement.end ?? 0;
    const lineEnd = code.indexOf('\n', end);
    return throwsComment.test(code.slice(end, lineEnd === -1 ? code.length : lineEnd));
  };
  const ast = parseCode(code, parseOpts);
  const statements = /** @type {EsNode[]} */ ('body' in ast ? ast.body : []).filter(isExpectedThrow);
  // replacing from the end keeps the earlier statements' positions valid
  return statements.reduceRight((altered, statement) => {
    const start = statement.start ?? 0;
    const end = statement.end ?? 0;
    const source = altered.slice(start, end);
    const message = JSON.stringify(`expected \`${source}\` to throw`);
    // each wrapper stays on the statement's own lines, so line numbers still map to the markdown
    const wrapper = hasTopLevelAwait(statement.expression)
      ? `await (async () => { ${source} })().then(() => { throw new Error(${message}); }, () => {});`
      : `{ let threw = false; try { ${source} } catch { threw = true; } if (!threw) { throw new Error(${message}); } }`;
    return replacePosition(altered, start, end, wrapper);
  }, code);
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
  code = alterExpectedThrows(code, parseOpts);
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
  alterExpectedThrows,
  alterModules,
  buildEvalable,
};
