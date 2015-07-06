// User Interface adapter for beats

define(function (require) {
var metronome = require('music/metronome');

var beats = {};

window.beatsUIChange = function (ta) { beats.change(ta.value); };
var html = '<p><textarea id="beats" rows="10" cols="50" oninput="beatsUIChange(this)">31\n21\n31\n21</textarea></p>';
document.body.innerHTML += html;

beats.change = function (v) {
};

return beats;
});
