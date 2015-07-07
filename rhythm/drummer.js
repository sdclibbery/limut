// Performance Domain

define(function (require) {
var percussion = require('rhythm/percussion.play');

var drummer = {};

drummer.event = function (event) {
  if (event.strength === 3) {
    percussion.kick(event.time);
  } else if (event.strength === 2) {
    percussion.snare(event.time);
  } else if (event.strength === 1) {
    percussion.hat(event.time);
  }
};

return drummer;
});
