// User Interface adapter for drummer

define(function (require) {
var myDrummer = require('rhythm/drummer');
var values = {
  k: 'kick',
  s: 'snare',
  o: 'openhat',
  c: 'closedhat'
};
var beatsUI = require('rhythm/beats.ui')({
  values: values,
  initial: 'kc\nsc\nkc\nsc',
  beats: myDrummer.beats
});

var drummer = {};

var key = Object.keys(values).reduce(function (c, v) { return c+(c?'/':'')+v; }, '');
var html = '<div class="widget"><h5>drummer</h5><div><h5>beats: '+key+'</h5>'+beatsUI.markup+'</div></div>';
document.body.innerHTML += html;

return drummer;
});
