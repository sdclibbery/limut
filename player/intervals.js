'use strict';
define(function(require) {

  return {
    combine: (l, r) => l == 'frame' ? 'frame' : (r == 'frame' ? 'frame' : (l || r)),
  }
})