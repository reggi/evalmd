'use strict';

const { styleText, stripVTControlCharacters } = require('util');

/** @param {string[]} args */
function errMsg(...args) {
  const parts = args.slice();
  if (parts.length > 1) {
    parts[0] = styleText('magenta', String(parts[0]));
  }
  return /** @type {string[]} */ ([]).concat(
    styleText('white', 'evalmd'),
    styleText('red', 'ERR!'),
    parts,
  ).join(' ');
}

/** @param {string[]} args */
function infoMsg(...args) {
  const parts = args.slice();
  parts[0] = styleText('magenta', String(parts[0]));
  return /** @type {string[]} */ ([]).concat(
    styleText('white', 'evalmd'),
    styleText('green', 'info'),
    parts,
  ).join(' ');
}

/** @param {string[]} args */
function debugMsg(...args) {
  const parts = args.slice();
  parts[0] = styleText('magenta', String(parts[0]));
  return /** @type {string[]} */ ([]).concat(
    styleText('white', 'evalmd'),
    styleText('blue', 'debug'),
    parts,
  ).join(' ');
}

/** @param {unknown} errOrStack */
function cleanStack(errOrStack) {
  if (errOrStack instanceof Error && errOrStack.stack) {
    return String(errOrStack).split(/\r\n?|\n/);
  }
  if (Array.isArray(errOrStack)) {
    return errOrStack;
  }
  if (errOrStack) {
    return String(errOrStack).split(/\r\n?|\n/);
  }
  return false;
}

/**
 * @param {{ debug?: boolean, silence?: boolean, store?: string[] & { all?: string[] } }} [options]
 */
function createLogger(options) {
  const opts = options || {};
  const debug = !!opts.debug;
  const silence = !!opts.silence;
  /** @type {string[] & { all?: string[] }} */
  const store = opts.store || [];

  /** @param {string} data */
  function write(data) {
    const colorLessData = stripVTControlCharacters(data);
    if (!store.all) {
      store.all = [];
    }
    store[store.length] = colorLessData;
    if (!silence) {
      return process.stderr.write(`${data}\n`);
    }
    return void undefined;
  }

  return {
    store,
    /** @param {string[]} args */
    info(...args) {
      return write(infoMsg(...args));
    },
    /** @param {string[]} args */
    debug(...args) {
      if (debug) {
        return write(debugMsg(...args));
      }
      return void undefined;
    },
    /** @param {unknown} err */
    err(err) {
      const lines = cleanStack(err);
      if (lines) {
        lines.forEach((line) => write(errMsg(line)));
      }
      return lines;
    },
  };
}

module.exports = createLogger;
module.exports.errMsg = errMsg;
module.exports.infoMsg = infoMsg;
module.exports.debugMsg = debugMsg;
module.exports.cleanStack = cleanStack;
