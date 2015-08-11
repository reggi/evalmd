var _ = require('lodash')
// var util = require('util')
var path = require('path')
var assert = require('assert')
var DESC = path.basename(__filename, path.extname(__filename))
var binDoc = require('../bin-doc')

/* global describe, it */

var doc = {
  'name': 'module-harvest',
  'description': 'Harvest pieces of npm module from single file.',
  'usage': {
    '<file>': 'Build module.',
    '--help | -h': 'Shows this help message.',
    '--version | -v': 'Show package version.'
  },
  'options': {
    'moduleFile': 'Javascript file to build into module.',
    'moduleName': 'Name of the module. (default: moduleFile name || jsdoc module def name)',
    'moduleDesc': 'Description of the module (default: jsdoc module def summary || jsdoc module def desc)',
    'packageSrc': 'Path to superproject package.json file',
    'localModulesDirName': 'Path to where local modules will build.',
    'directory': 'Path to directory (defaults: \'./\')',
    'buildLinks': 'Array of src, [src], or [src, dst] hard link definitions, from \'./\' to `local_module`.',
    'trackDeps': 'Array of src, [src] javascript definitions, from \'./\' to `local_module`.',
    'trackDevDeps': 'Function returning array of src, [src] javascript testdefinitions, from \'./\' to `local_module`.',
    'postBuildReverseLinks': 'Array of src, [src], or [src, dst] hard link definitions, from `local_module` to \'./\'.',
    'githubAccessToken': 'Github access token',
    'githubRepoPrefix': 'Github repo prefix (ex: \'node-\')',
    'preventMerge': 'Boolean option for prevent default merge options.'
  },
  'optionAliases': {
    'moduleFile': ['file'],
    'moduleName': ['name'],
    'moduleDesc': ['desc'],
    'packageSrc': ['package']
  }
}

describe(DESC, function () {

  describe('binDoc()', function () {
    it('should work', function () {
      var expected = [
        '',
        'module-harvest - Harvest pieces of npm module from single file.',
        '',
        'Usage:',
        '    module-harvest <file>          Build module.',
        '    module-harvest --help | -h     Shows this help message.',
        '    module-harvest --version | -v  Show package version.',
        '',
        'Options:',
        '    --moduleFile | --file          Javascript file to build into module.',
        '    --moduleName | --name          Name of the module. (default: moduleFile name || jsdoc module def name)',
        '    --moduleDesc | --desc          Description of the module (default: jsdoc module def summary || jsdoc module def desc)',
        '    --packageSrc | --package       Path to superproject package.json file',
        '    --localModulesDirName          Path to where local modules will build.',
        '    --directory                    Path to directory (defaults: \'./\')',
        '    --buildLinks                   Array of src, [src], or [src, dst] hard link definitions, from \'./\' to `local_module`.',
        '    --trackDeps                    Array of src, [src] javascript definitions, from \'./\' to `local_module`.',
        '    --trackDevDeps                 Function returning array of src, [src] javascript testdefinitions, from \'./\' to `local_module`.',
        '    --postBuildReverseLinks        Array of src, [src], or [src, dst] hard link definitions, from `local_module` to \'./\'.',
        '    --githubAccessToken            Github access token',
        '    --githubRepoPrefix             Github repo prefix (ex: \'node-\')',
        '    --preventMerge                 Boolean option for prevent default merge options.',
        ''
      ]
      assert.equal(binDoc(doc), expected.join('\n'))
    })
  })

  describe('binDoc.longestString()', function () {
    it('should work', function () {
      assert.equal(binDoc.longestString(_.keys(doc.options)), 21)
    })
  })
})
