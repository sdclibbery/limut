'use strict';
define(function (require) {

    // input should be a value 0 to 100, outputs 0.0 to 1.0
    return function equalPower(input) {
      if (input > 100) { return 1 }
      if (input < 0) { return 0 }
      const output = Math.cos((1.0 - input / 100) * 0.5 * Math.PI);
      return Math.round(output * 100) / 100;
    }
  
})  