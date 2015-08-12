#!/usr/bin/env node
var minimist = require('minimist')
var argv = minimist(process.argv.slice(2))
var testMarkdown = require('../test-markdown')
var pkg = require('../package.json')
var binDoc = require('../bin-doc')

var doc = {
  'name': pkg.name,
  'desc': pkg.description,
  'usage': {
    '<file|files>': 'File or files via glob.',
    '--help | -h': 'Shows this help message.',
    '--version | -v': 'Show package version.'
  },
  'options': {
    'output': 'Logs the stirng output of code.',
    'prepend': 'Prepends all local module loads with path.'
  },
  'optionAliases': {
    'output': ['-o']
  }
}

if (argv.v || argv.version) {

  console.log(pkg.version)

} else if (argv._.length) {

  var output = argv.output || argv.o || false
  var prepend = argv.prepend || false
  testMarkdown(argv._, output, prepend)

} else {

  console.log(binDoc(doc))

}
