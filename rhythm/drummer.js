// Performance Domain

define(function (require) {
var percussion = require('rhythm/percussion.play');

var drummer = {};

drummer.event = function (event) {
  percussion[event.value](event.time);
};

return drummer;
});
