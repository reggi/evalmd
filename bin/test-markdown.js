#!/usr/bin/env node
var minimist = require('minimist')
var argv = minimist(process.argv.slice(2))
var testMarkdown = require('../test-markdown')
var pkg = require('../package.json')
var binDoc = require('../bin-doc')

var doc = {
  'name': pkg.name,
  'desc': pkg.description,
  'author': pkg.author,
  'usage': {
    '<file|files>': 'File or files via glob.',
    '--help | -h': 'Shows this help message.',
    '--version | -v': 'Show package version.'
  },
  'options': {
    'output': 'Logs the stirng output of code.'
  },
  'optionAliases': {
    'output': ['-o']
  }
}

if (argv.v || argv.version) {
  console.log(pkg.version)
} else if (argv._.length) {
  var o = argv.output || argv.o || false
  testMarkdown(argv._, o)
} else {
  console.log(binDoc(doc))
}
