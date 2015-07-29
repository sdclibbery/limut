// User Interface adapter for drummer

define(function (require) {
var myDrummer = require('rhythm/drummer');
var beatsUI = require('rhythm/beats.ui')({
  values: {
    k: 'kick',
    s: 'snare',
    o: 'openhat',
    c: 'closedhat'
  },
  initial: 'kc\nsc\nkc\nsc',
  beats: myDrummer.beats
});

var drummer = {};

var markup = '';

var html = '<div class="widget"><h5>drummer</h5>'+markup+'</div>';
document.body.innerHTML += html;

return drummer;
});
