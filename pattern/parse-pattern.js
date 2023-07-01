'use strict';
define(function(require) {
  let patternLiteral = require('pattern/pattern-literal.js')

  let parsePattern = (patternStr, params) => {
    return patternLiteral(patternStr, params)
  }

  return parsePattern

})