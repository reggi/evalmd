#!/usr/bin/env node
var path = require('path')
var yargs = require('yargs')
var fs = require('fs')
var evalMarkdown = require('./eval-markdown')
var argv = yargs
  .usage('$0 - Evaluate the javascript in markdown files')
  .example('$0 <file(s)>', 'Evaluate file(s)')
  .example('$0 <file(s)> -n', 'Evaluate file(s) uninterrupted')
  .example('$0 <file(s)> -b', 'Evaluate block(s)')
  .example('$0 <file(s)> -bn', 'Evaluate block(s) uninterrupted')
  .example('$0 <file(s)> -Po', 'Outputs js file(s)')
  .example('$0 <file(s)> -Pio', 'Outputs js file(s) with all block(s) (for linting)')
  .example('$0 <file(s)> -Pob', 'Outputs block(s)')
  .example('$0 <file(s)> -Piob', 'Outputs all blocks(s) (for linting)')
  .example('$0 <file(s)> --eval=js,sh', 'Evaluate js and sh block(s)')
  .default('i', false)
  .alias('i', 'include')
  .describe('i', 'Includes prevented blocks')
  .default('P', false)
  .alias('P', 'prevent')
  .describe('P', 'Prevent code from being evaluated')
  .default('b', false)
  .alias('b', 'block')
  .describe('b', 'Change the scope to block level')
  .default('o', false)
  .alias('o', 'output')
  .choices('o', [false, true, 'preserve', 'concat', 'preserveAlter', 'concatAlter'])
  .describe('o', 'Output js')
  .default('n', false)
  .alias('n', 'nonstop')
  .describe('n', 'Runs all files regardless if error')
  .default('s', false)
  .alias('s', 'silent')
  .describe('s', 'Silence `evalmd` logging')
  .default('u', false)
  .alias('u', 'uniform')
  .describe('u', 'Does not use absolute urls when error logging')
  .default('d', false)
  .alias('d', 'delimeter')
  .default('D', false)
  .alias('D', 'debug')
  .describe('D', 'Debug Output')
  .default('e', 'js')
  .alias('e', 'eval')
  .describe('e', 'Comma-separated list of block kinds to evaluate (e.g. js, sh)')
  .default('sloppy', false)
  .describe('sloppy', 'Evaluate code in sloppy (non-strict) mode')
  .default('eslint', false)
  .describe('eslint', 'Derive parser settings (ecmaVersion, sourceType, parser) from your eslint config per block')
  .help('h')
  .alias('h', 'help')
  .describe('path', 'Prefix local module with path')
  .default('path', './')
  .describe('package', 'Th path of a package.json')
  .default('package', './package.json')
  .version((function () {
    var pkg = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    return JSON.parse(pkg).version
  }()))
  .wrap(null)
  .argv

var files = argv._

if (files.length) {

  var evalLangs = String(argv.eval).split(',').map(function (kind) { return kind.trim() }).filter(Boolean)

  evalMarkdown(
    files,
    argv.package,
    argv.path,
    argv.block,
    argv.nonstop,
    argv.prevent,
    argv.include,
    argv.silent,
    argv.debug,
    argv.output,
    argv.delimeter,
    evalLangs,
    argv.sloppy,
    argv.eslint
  ).then((report: { exitCode: number }) => {
    process.exit(report.exitCode)
  })
  .catch(() => {
    process.exit(1)
  })

} else {
  yargs.showHelp('log')
}
