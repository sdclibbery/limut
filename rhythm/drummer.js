// Performance Domain

define(function (require) {

var percussion = require('rhythm/percussion.play');

var beats = require('rhythm/beats');
var beatsUI = require('rhythm/beats.ui');
beatsUI.target(beats);

beats.event = function (event) {
  percussion[event.value](event.time);
};

var drummer = {};

return drummer;
});
