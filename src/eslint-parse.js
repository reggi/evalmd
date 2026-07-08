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
  } catch (e) {
    // eslint-disable-next-line preserve-caught-error
    throw new Error('the `--eslint` flag requires `eslint` (8, 9, or 10) to be installed');
  }
  // eslint-disable-next-line global-require
  return require(resolved);
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
  } catch (e) {
    return {};
  }
}

/** @param {string} cwd */
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
    } catch (e) {}
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
    return (major <= 8) ? eslint.ESLint : (legacy.LegacyESLint || eslint.ESLint);
  }
  return (major >= 9) ? eslint.ESLint : (legacy.FlatESLint || eslint.ESLint);
}

/** @param {any} node */
function visitNode(node) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (typeof node.type === 'string') {
    if (node.start === undefined && node.range) {
      // eslint-disable-next-line no-param-reassign
      node.start = node.range[0];
    }
    if (node.end === undefined && node.range) {
      // eslint-disable-next-line no-param-reassign
      node.end = node.range[1];
    }
  }
  Object.keys(node).forEach((key) => {
    if (key === 'parent') {
      return;
    }
    /** @type {any} */
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach(/** @param {any} item */ (item) => visitNode(item));
    } else {
      /** @type {any} */
      const obj = value;
      if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
        visitNode(obj);
      }
    }
  });
}

/** @param {any} ast */
function normalizeNodePositions(ast) {
  visitNode(ast);
  return ast;
}

/**
 * @param {any} config
 * @param {string} cwd
 */
function parserFor(config, cwd) {
  const languageOptions = config.languageOptions;
  if (languageOptions) {
    const flatOptions = { ecmaVersion: languageOptions.ecmaVersion, sourceType: languageOptions.sourceType };
    Object.assign(flatOptions, languageOptions.parserOptions);
    return { parser: languageOptions.parser || loadEspree(cwd), options: flatOptions };
  }
  // eslint-disable-next-line global-require
  const rcParser = config.parser ? require(config.parser) : loadEspree(cwd);
  const rcOptions = {};
  Object.assign(rcOptions, config.parserOptions);
  return { parser: rcParser, options: rcOptions };
}

/**
 * @param {any} config
 * @param {string} cwd
 */
function toParseFn(config, cwd) {
  const resolved = parserFor(config, cwd);
  const parser = resolved.parser;
  const options = resolved.options;
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
