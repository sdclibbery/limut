// User Interface adapter for drummer

define(function (require) {
var myDrummer = require('rhythm/drummer');
var beatsUI = require('rhythm/beats.ui')();
beatsUI.target(myDrummer.beats);

var drummer = {};

var markup = '';

var html = '<div class="widget"><h5>drummer</h5>'+markup+'</div>';
document.body.innerHTML += html;

return drummer;
});
