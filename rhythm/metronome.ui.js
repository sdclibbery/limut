// User Interface adapter for metronome

define(function (require) {
var myMetronome = require('rhythm/metronome');

var metronome = {};

var bpmMarkup = 'bpm: <input type="range" min="60" max="200" value="'+myMetronome.bpm()+'" oninput="bpmChange(this)" style="width:80%;" />';
window.bpmChange = function (ta) {
  myMetronome.bpm(ta.value);
};
var pmMarkup = 'beats per measure: <input type="number" min="2" max="9" value="'+myMetronome.beatsPerMeasure()+'" oninput="pmChange(this)" />';
window.pmChange = function (ta) {
  myMetronome.beatsPerMeasure(ta.value);
};
var html = '<p>'+bpmMarkup+'<br />'+pmMarkup+'</p>';
document.body.innerHTML += html;

return metronome;
});
