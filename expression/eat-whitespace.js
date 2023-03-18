'use strict';
define(function(require) {
  return (state) => {
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      break
    }
  }
})
