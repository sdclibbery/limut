'use strict';
define(function (require) {

  return class ADGenerator {
    constructor(type, attack, decay, start, amount) {
      this.type = type;
      this.attack = attack;
      this.decay = decay;
      this.start = start;
      this.amount = amount;
    }

    trigger(time) {
      this.param.cancelScheduledValues(0);
      // this.param.linearRampToValueAtTime(this.param.value, time);

      this.param.linearRampToValueAtTime(this.start, time);
      const attackTime = time + this.attack / 1000;
      const decayTime = attackTime + this.decay / 1000;
      this.param.linearRampToValueAtTime(this.start + this.amount, attackTime);
      switch (this.type) {
        case "linear":
          this.param.linearRampToValueAtTime(this.start, decayTime);
          break;
        case "exponential":
          this.param.exponentialRampToValueAtTime(0.0001 + this.start, decayTime);
          break;
        default:
          throw new Error("Invalid AD type");
      }
    }

    connect(param) {
      this.param = param;
    }
  }
})