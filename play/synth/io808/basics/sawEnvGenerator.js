'use strict';
define(function (require) {
  const REVER_INTERVAL = 1 / 100;

  return class SawEnvGenerator {
    connect(param) {
      this.param = param;
    }

    trigger(time) {
      this.param.cancelScheduledValues(0);

      let timeOffset = 0;
      for (let i = 0; i < 4; i++) {
        this.param.setValueAtTime(1-i/10, time + timeOffset);
        timeOffset += REVER_INTERVAL;
        this.param.exponentialRampToValueAtTime(0.00001, time + timeOffset);
      }
    }
  }
})