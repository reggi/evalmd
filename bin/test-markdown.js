#!/usr/bin/env node
var minimist = require('minimist')
var argv = minimist(process.argv.slice(2))
var testMarkdown = require('../test-markdown')
var pkg = require('../package.json')
var binDoc = require('../bin-doc')
var markdownPath = (argv.path) ? argv.path : argv._.shift()

var doc = {
  'name': pkg.name,
  'desc': pkg.description,
  'usage': {
    '<path>': 'File or directory of markdown files to test.'
  },
  'options': {
    'path': 'File or directory of markdown files to test.'
  }
}

if (argv.v || argv.version) {
  console.log(pkg.version)
} else if (markdownPath) {
  testMarkdown(markdownPath)
} else {
  console.log(binDoc(doc))
}
