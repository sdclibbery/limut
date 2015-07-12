// Performance Domain

define(function (require) {
var percussion = require('rhythm/percussion.play');

var drummer = {};

//var strengthToInstruments = [ [], [], [], [] ]; // List (indexed by beat strength) of instruments to play for that strength
var strengthToInstruments = [
  [],
  [ 'hat' ],
  [ 'snare' ],
  [ 'kick' ]
];

drummer.event = function (event) {
  var instruments = strengthToInstruments[event.strength];
  instruments.map(function (instrument) {
    percussion[instrument](event.time);
  });
};

return drummer;
});
