'use strict';

const path = require('path');
const fs = require('fs');

const FLAT_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];
const RC_NAMES = [
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc',
];

/** @import { EsNode } from './types' */

/**
 * @param {string} id
 * @param {string} cwd
 */
function resolveFrom(id, cwd) {
  return require.resolve(id, { paths: [cwd, __dirname] });
}

/** @param {string} cwd */
function loadEslint(cwd) {
  let resolved;
  try {
    resolved = resolveFrom('eslint', cwd);
  } catch {
    throw new Error('the `--eslint` flag requires `eslint` (8, 9, or 10) to be installed');
  }
  try {
    // eslint-disable-next-line global-require
    return require(resolved);
  } catch (e) {
    const reason = /** @type {Error} */ (e).message;
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`the \`--eslint\` flag found \`eslint\` at ${resolved} but could not load it, which usually means it requires a newer node than ${process.version}: ${reason}`);
  }
}

/** @param {string} cwd */
function eslintMajor(cwd) {
  // eslint-disable-next-line global-require
  return parseInt(String(require(resolveFrom('eslint/package.json', cwd)).version).split('.')[0], 10);
}

/** @param {string} cwd */
function useAtYourOwnRisk(cwd) {
  try {
    // eslint-disable-next-line global-require
    return require(resolveFrom('eslint/use-at-your-own-risk', cwd));
  } catch {
    return {};
  }
}

/**
 * @param {string} cwd
 * @returns {Parser}
 */
function loadEspree(cwd) {
  const eslintDir = path.dirname(resolveFrom('eslint/package.json', cwd));
  // eslint-disable-next-line global-require
  return require(require.resolve('espree', { paths: [eslintDir] }));
}

/** @param {string} fromDir */
function detectFormat(fromDir) {
  if (FLAT_NAMES.some((name) => fs.existsSync(path.join(fromDir, name)))) {
    return 'flat';
  }
  if (RC_NAMES.some((name) => fs.existsSync(path.join(fromDir, name)))) {
    return 'eslintrc';
  }
  const pkgPath = path.join(fromDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).eslintConfig) {
        return 'eslintrc';
      }
    } catch {}
  }
  const parent = path.dirname(fromDir);
  if (parent === fromDir) {
    return false;
  }
  return detectFormat(parent);
}

/**
 * @param {string} format
 * @param {string} cwd
 */
function eslintClass(format, cwd) {
  const eslint = loadEslint(cwd);
  const major = eslintMajor(cwd);
  const legacy = useAtYourOwnRisk(cwd);
  if (format === 'eslintrc') {
    return major <= 8 ? eslint.ESLint : (legacy.LegacyESLint || eslint.ESLint);
  }
  return major >= 9 ? eslint.ESLint : (legacy.FlatESLint || eslint.ESLint);
}

/** @param {EsNode} node */
function visitNode(node) {
  if (!node || typeof node !== 'object') {
    return;
  }
  const { range } = node;
  if (typeof node.type === 'string' && range) {
    if (node.start === undefined) {
      [node.start] = range;
    }
    if (node.end === undefined) {
      [, node.end] = range;
    }
  }

  const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node));
  Object.keys(record).forEach((key) => {
    if (key === 'parent') {
      return;
    }
    const value = record[key];
    if (Array.isArray(value)) {
      value.forEach((item) => visitNode(item));
    } else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') {
      visitNode(/** @type {EsNode} */ (value));
    }
  });
}

/**
 * @template {EsNode} T
 * @param {T} ast
 * @returns {T}
 */
function normalizeNodePositions(ast) {
  visitNode(ast);
  return ast;
}

/**
 * @typedef {{
 *   parse: (code: string, options?: unknown) => EsNode,
 *   parseForESLint?: (code: string, options?: unknown) => { ast: EsNode },
 * }} Parser
 */

/**
 * @typedef {{
 *   languageOptions?: {
 *     ecmaVersion?: unknown,
 *     sourceType?: unknown,
 *     parserOptions?: object,
 *     parser?: Parser,
 *   },
 *   parser?: string,
 *   parserOptions?: object,
 * }} EslintConfig
 */

/**
 * @param {EslintConfig} config
 * @param {string} cwd
 */
function parserFor(config, cwd) {
  const { languageOptions } = config;
  if (languageOptions) {
    const flatOptions = {
      ecmaVersion: languageOptions.ecmaVersion,
      sourceType: languageOptions.sourceType,
      ...languageOptions.parserOptions,
    };
    return { parser: languageOptions.parser || loadEspree(cwd), options: flatOptions };
  }
  // eslint-disable-next-line global-require
  const rcParser = config.parser ? /** @type {Parser} */ (require(config.parser)) : loadEspree(cwd);
  return {
    parser: rcParser,
    options: { ...config.parserOptions },
  };
}

/**
 * @param {EslintConfig} config
 * @param {string} cwd
 */
function toParseFn(config, cwd) {
  const resolved = parserFor(config, cwd);
  const { parser, options } = resolved;
  return /** @param {string} code */ function (code) {
    const result = parser.parseForESLint
      ? parser.parseForESLint(code, options)
      : { ast: parser.parse(code, options) };
    return normalizeNodePositions(result.ast);
  };
}

/**
 * @param {string} filePath
 * @param {string} blockId
 * @param {string} cwd
 */
function resolveParse(filePath, blockId, cwd) {
  const absMarkdown = path.resolve(cwd, filePath);
  const virtualPath = path.join(absMarkdown, `${blockId}.js`);
  const format = detectFormat(path.dirname(absMarkdown)) || 'flat';
  const Cls = eslintClass(format, cwd);
  const instance = new Cls({ cwd });
  return Promise.resolve(instance.calculateConfigForFile(virtualPath)).then((config) => {
    if (!config) {
      return false;
    }
    return toParseFn(config, cwd);
  });
}

module.exports = resolveParse;
module.exports.detectFormat = detectFormat;
module.exports.normalizeNodePositions = normalizeNodePositions;
