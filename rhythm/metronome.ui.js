// User Interface adapter for metronome

define(function (require) {
var myMetronome = require('rhythm/metronome');

var metronome = {};

var bpmMarkup = 'bpm: <input type="range" min="60" max="200" value="'+myMetronome.bpm()+'" oninput="bpmChange(this)" style="width:85%;" />';
window.bpmChange = function (ta) {
  myMetronome.bpm(ta.value);
};
var pmMarkup = 'beats per measure: <input type="number" min="2" max="9" value="'+myMetronome.beatsPerMeasure()+'" oninput="pmChange(this)" />';
window.pmChange = function (ta) {
  myMetronome.beatsPerMeasure(ta.value);
};
var html = '<div class="widget"><h5>metronome</h5>'+bpmMarkup+'<br />'+pmMarkup+'</div>';
document.body.innerHTML += html;

return metronome;
});
