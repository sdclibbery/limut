'use strict';
define(function (require) {
  let param = require('player/default-param')

  let subParam = (p, name, def) => {
    if (typeof p === 'object') {
      return param(p[name], def)
    }
    return def
  }

  let mainParam = (p, def) => {
    if (typeof p !== 'object') {
      return param(p, def)
    }
    return param(p.value, def)
  }

  return {
    subParam: subParam,
    mainParam: mainParam,
  }
})