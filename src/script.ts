#!/usr/bin/env node
const evalMarkdown = require('./eval-markdown');

const config = {
  allowPositionals: true,
  minPositionals: 1,
  positionals: [{
    name: 'file', description: 'markdown file(s) to evaluate', rest: true,
  }],
  description: {
    summary: 'Evaluate the javascript in markdown files',
    examples: [
      { command: '$0 <file(s)>', description: 'Evaluate file(s)' },
      { command: '$0 <file(s)> -n', description: 'Evaluate file(s) uninterrupted' },
      { command: '$0 <file(s)> -b', description: 'Evaluate block(s)' },
      { command: '$0 <file(s)> -bn', description: 'Evaluate block(s) uninterrupted' },
      { command: '$0 <file(s)> -Po', description: 'Outputs js file(s)' },
      { command: '$0 <file(s)> -Pio', description: 'Outputs js file(s) with all block(s) (for linting)' },
      { command: '$0 <file(s)> -Pob', description: 'Outputs block(s)' },
      { command: '$0 <file(s)> -Piob', description: 'Outputs all blocks(s) (for linting)' },
      { command: '$0 <file(s)> --eval=js,sh', description: 'Evaluate js and sh block(s)' },
    ],
  },
  options: {
    include: {
      type: 'boolean', short: 'i', default: false, description: 'Includes prevented blocks',
    },
    prevent: {
      type: 'boolean', short: 'P', default: false, description: 'Prevent code from being evaluated',
    },
    block: {
      type: 'boolean', short: 'b', default: false, description: 'Change the scope to block level',
    },
    output: {
      type: 'boolean', short: 'o', default: false, description: 'Output js',
    },
    'output-format': {
      type: 'enum',
      choices: ['preserve', 'concat', 'preserveAlter', 'concatAlter'],
      default: 'preserve',
      description: 'Which form of code `--output` writes',
    },
    nonstop: {
      type: 'boolean', short: 'n', default: false, description: 'Runs all files regardless if error',
    },
    silent: {
      type: 'boolean', short: 's', default: false, description: 'Silence `evalmd` logging',
    },
    uniform: {
      type: 'boolean', short: 'u', default: false, description: 'Does not use absolute urls when error logging',
    },
    delimeter: {
      type: 'boolean', short: 'd', default: false,
    },
    debug: {
      type: 'boolean', short: 'D', default: false, description: 'Debug Output',
    },
    eval: {
      type: 'string', short: 'e', default: 'js', description: 'Comma-separated list of block kinds to evaluate (e.g. js, sh)',
    },
    sloppy: {
      type: 'boolean', default: false, description: 'Evaluate code in sloppy (non-strict) mode',
    },
    eslint: {
      type: 'boolean', default: false, description: 'Derive parser settings (ecmaVersion, sourceType, parser) from your eslint config per block',
    },
    path: {
      type: 'string', default: './', description: 'Prefix local module with path',
    },
    package: {
      type: 'string', default: './package.json', description: 'The path of a package.json',
    },
  },
} as const;

(async () => {
  const { default: pargs } = await import('pargs');

  const {
    values, positionals, help,
  } = await pargs(__filename, config);

  await help();

  const evalLangs = String(values.eval).split(',').map((kind) => kind.trim()).filter(Boolean);
  const output = values.output ? values['output-format'] : false;

  const report: { exitCode: number } = await evalMarkdown(
    positionals,
    values.package,
    values.path,
    values.block,
    values.nonstop,
    values.prevent,
    values.include,
    values.silent,
    values.debug,
    output,
    values.delimeter,
    evalLangs,
    values.sloppy,
    values.eslint,
  );
  process.exit(report.exitCode);
})().catch(() => {
  process.exit(1);
});
