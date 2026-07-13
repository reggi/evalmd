'use strict';

const childProcess = require('child_process');

/** @type {{ [kind: string]: string[] }} */
const KIND_LANGS = {
  js: ['js', 'javascript'],
  sh: ['sh'],
};

/** @param {readonly string[]} evalLangs */
function normalizeKinds(evalLangs) {
  /** @type {string[]} */
  const kinds = [];
  evalLangs.forEach((lang) => {
    const kind = (lang === 'javascript') ? 'js' : lang;
    if (kind && kinds.indexOf(kind) === -1) { kinds.push(kind); }
  });
  return kinds;
}

/** @param {string | undefined} content */
function parsePromptBlock(content) {
  const lines = String(content || '').split(/\r\n?|\n/);
  /** @type {{ command: string, output: string[] }[]} */
  const commands = [];
  /** @type {false | { command: string, output: string[] }} */
  let current = false;
  lines.forEach((line) => {
    const match = line.match(/^[$%>]\s+(.*)$/);
    if (match) {
      current = { command: match[1], output: [] };
      commands.push(current);
    } else if (current) {
      current.output.push(line);
    }
  });
  return commands.map((item) => ({ command: item.command, expected: item.output.join('\n') }));
}

/** @param {string} command */
function runPromptCommand(command) {
  const mergeStderrIntoStdout = `( ${command} ) 2>&1`;
  return new Promise((resolve) => {
    childProcess.exec(mergeStderrIntoStdout, (error, stdout) => {
      resolve({
        code: (error) ? ((typeof error.code === 'number') ? error.code : 1) : 0,
        output: String((stdout === null || stdout === undefined) ? '' : stdout),
      });
    });
  });
}

/**
 * @param {{ command: string, expected: string }} item
 * @param {{ code: number, output: string }} result
 */
function checkPromptCommand(item, result) {
  const actual = String(result.output).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const expected = String(item.expected).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (result.code !== 0) {
    return new Error(`command \`${item.command}\` exited with code ${result.code}${actual ? `\n${actual}` : ''}`);
  }
  if (actual !== expected) {
    return new Error([
      `command \`${item.command}\` output did not match:`,
      '--- expected ---',
      expected,
      '--- actual ---',
      actual,
    ].join('\n'));
  }
  return false;
}

module.exports = {
  KIND_LANGS,
  normalizeKinds,
  parsePromptBlock,
  runPromptCommand,
  checkPromptCommand,
};
