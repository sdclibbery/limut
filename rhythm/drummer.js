// Performance Domain

define(function (require) {
var percussion = require('rhythm/percussion.play');

var drummer = {};

var strengthToInstruments = [ [], [], [], [] ]; // List (indexed by beat strength) of instruments to play for that strength

drummer.on = function (strength, instrument) {
  drummer.off(strength, instrument);
  strengthToInstruments[strength].push(instrument);
};

drummer.off = function (strength, instrument) {
  strengthToInstruments[strength] = strengthToInstruments[strength].filter(function (i) {
    return i !== instrument;
  });
};

drummer.event = function (event) {
  var instruments = strengthToInstruments[event.value];
  instruments.map(function (instrument) {
    percussion[instrument](event.time);
  });
};

return drummer;
});
