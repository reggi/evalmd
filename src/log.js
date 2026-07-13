'use strict';

const chalk = require('chalk');

/** @param {...any} args */
function errMsg(...args) {
  const parts = args.slice();
  if (parts.length > 1) {
    parts[0] = chalk.magenta(parts[0]);
  }
  return [
    chalk.white('evalmd'),
    chalk.red('ERR!'),
  ].concat(parts).join(' ');
}

/** @param {...any} args */
function infoMsg(...args) {
  const parts = args.slice();
  parts[0] = chalk.magenta(parts[0]);
  return [
    chalk.white('evalmd'),
    chalk.green('info'),
  ].concat(parts).join(' ');
}

/** @param {...any} args */
function debugMsg(...args) {
  const parts = args.slice();
  parts[0] = chalk.magenta(parts[0]);
  return [
    chalk.white('evalmd'),
    chalk.blue('debug'),
  ].concat(parts).join(' ');
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
  const debug = Boolean(opts.debug);
  const silence = Boolean(opts.silence);
  /** @type {string[] & { all?: string[] }} */
  const store = opts.store || [];

  /** @param {string} data */
  function write(data) {
    const colorLessData = chalk.stripColor(data);
    if (!store.all) {
      store.all = [];
    }
    store.push(colorLessData);
    if (!silence) {
      return process.stderr.write(`${data}\n`);
    }
    return undefined;
  }

  return {
    store,
    /** @param {...any} args */
    info(...args) {
      return write(infoMsg.apply(null, args));
    },
    /** @param {...any} args */
    debug(...args) {
      if (debug) {
        return write(debugMsg.apply(null, args));
      }
      return undefined;
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
