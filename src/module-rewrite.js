'use strict';

const path = require('path');

/**
 * @param {string} str
 * @param {number} start
 * @param {number} end
 * @param {string} value
 */
function replacePosition(str, start, end, value) {
  return str.substr(0, start) + value + str.substr(end);
}

/** @param {string} replacement */
function toRequirePath(replacement) {
  return replacement.split(path.sep).join('/');
}

/** @param {string} s */
function regExpEscape(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

module.exports = {
  replacePosition,
  toRequirePath,
  regExpEscape,
};
