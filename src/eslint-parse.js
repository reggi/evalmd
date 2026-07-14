var path = require('path')
var fs = require('fs')

var FLAT_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts'
]
var RC_NAMES = [
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc'
]

/**
 * @param {string} id
 * @param {string} cwd
 */
function resolveFrom(id, cwd) {
  return require.resolve(id, { paths: [cwd, __dirname] })
}

/** @param {string} cwd */
function loadEslint(cwd) {
  var resolved
  try {
    resolved = resolveFrom('eslint', cwd)
  } catch (e) {
    throw new Error('the `--eslint` flag requires `eslint` (8, 9, or 10) to be installed')
  }
  return require(resolved)
}

/** @param {string} cwd */
function eslintMajor(cwd) {
  return parseInt(String(require(resolveFrom('eslint/package.json', cwd)).version).split('.')[0], 10)
}

/** @param {string} cwd */
function useAtYourOwnRisk(cwd) {
  try {
    return require(resolveFrom('eslint/use-at-your-own-risk', cwd))
  } catch (e) {
    return {}
  }
}

/** @param {string} cwd */
function loadEspree(cwd) {
  var eslintDir = path.dirname(resolveFrom('eslint/package.json', cwd))
  return require(require.resolve('espree', { paths: [eslintDir] }))
}

/** @param {string} fromDir */
function detectFormat(fromDir) {
  var dir = fromDir
  for (;;) {
    if (FLAT_NAMES.some(function (name) { return fs.existsSync(path.join(dir, name)) })) {
      return 'flat'
    }
    if (RC_NAMES.some(function (name) { return fs.existsSync(path.join(dir, name)) })) {
      return 'eslintrc'
    }
    var pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).eslintConfig) { return 'eslintrc' }
      } catch (e) {}
    }
    var parent = path.dirname(dir)
    if (parent === dir) { return false }
    dir = parent
  }
}

/**
 * @param {string} format
 * @param {string} cwd
 */
function eslintClass(format, cwd) {
  var eslint = loadEslint(cwd)
  var major = eslintMajor(cwd)
  var legacy = useAtYourOwnRisk(cwd)
  if (format === 'eslintrc') {
    return (major <= 8) ? eslint.ESLint : (legacy.LegacyESLint || eslint.ESLint)
  }
  return (major >= 9) ? eslint.ESLint : (legacy.FlatESLint || eslint.ESLint)
}

/** @param {any} ast */
function normalizeNodePositions(ast) {
  var stack = [ast]
  while (stack.length) {
    var node = stack.pop()
    if (node && typeof node === 'object' && typeof node.type === 'string') {
      if (node.start === undefined && node.range) { node.start = node.range[0] }
      if (node.end === undefined && node.range) { node.end = node.range[1] }
    }
    if (node && typeof node === 'object') {
      Object.keys(node).forEach(function (key) {
        if (key === 'parent') { return }
        /** @type {any} */
        var value = node[key]
        /** @type {boolean} */
        var valueIsArray = Array.isArray(value)
        if (valueIsArray) {
          value.forEach(/** @param {any} item */ function (item) { stack.push(item) })
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          stack.push(value)
        }
      })
    }
  }
  return ast
}

/**
 * @param {any} config
 * @param {string} cwd
 */
function parserFor(config, cwd) {
  var languageOptions = config.languageOptions
  if (languageOptions) {
    var flatOptions = Object.assign(
      { ecmaVersion: languageOptions.ecmaVersion, sourceType: languageOptions.sourceType },
      languageOptions.parserOptions
    )
    return { parser: languageOptions.parser || loadEspree(cwd), options: flatOptions }
  }
  var rcParser = config.parser ? require(config.parser) : loadEspree(cwd)
  return { parser: rcParser, options: Object.assign({}, config.parserOptions) }
}

/**
 * @param {any} config
 * @param {string} cwd
 */
function toParseFn(config, cwd) {
  var resolved = parserFor(config, cwd)
  var parser = resolved.parser
  var options = resolved.options
  return /** @param {string} code */ function (code) {
    var result = parser.parseForESLint
      ? parser.parseForESLint(code, options)
      : { ast: parser.parse(code, options) }
    return normalizeNodePositions(result.ast)
  }
}

/**
 * @param {string} filePath
 * @param {string} blockId
 * @param {string} cwd
 */
function resolveParse(filePath, blockId, cwd) {
  var absMarkdown = path.resolve(cwd, filePath)
  var virtualPath = path.join(absMarkdown, blockId + '.js')
  var format = detectFormat(path.dirname(absMarkdown)) || 'flat'
  var Cls = eslintClass(format, cwd)
  var instance = new Cls({ cwd: cwd })
  return Promise.resolve(instance.calculateConfigForFile(virtualPath)).then(function (config) {
    if (!config) { return false }
    return toParseFn(config, cwd)
  })
}

module.exports = resolveParse
module.exports.detectFormat = detectFormat
module.exports.normalizeNodePositions = normalizeNodePositions
