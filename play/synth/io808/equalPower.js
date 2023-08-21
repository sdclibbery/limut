'use strict';
define(function (require) {

    // input should be a value 0 to 100, outputs 0.0 to 1.0
    return function equalPower(input) {
      const output = Math.cos((1.0 - input / 100) * 0.5 * Math.PI);
      return Math.round(output * 100) / 100;
    }
  
})  