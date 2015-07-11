// User Interface adapter for beats

define(function (require) {
var metronome = require('rhythm/metronome');

var beats = {};
var myBeats;

var initial = '31\n21\n31\n21';
window.beatsUIChange = function (ta) { beats.change(ta.value); };
var html = '<div class="widget"><h5>beats</h5><textarea id="beats" rows="9" cols="32" oninput="beatsUIChange(this)">'+initial+'</textarea></div>';
document.body.innerHTML += html;

beats.change = function (v) {
  myBeats.strengths(parse(v));
};

beats.target = function (beatsDomain) {
  myBeats = beatsDomain;
  beats.change(initial);
};

var lookup = { '3': 3, '2': 2, '1': 1 };
var parse = function (v) {
  var bs = [];
  var ds = [];
  for (var i = 0; i < v.length; i++) {
    var c = v[i];
    if (c === '\n') {
      bs.push(ds);
      ds = [];
    } else {
      ds.push(lookup[c] || 0);
    }
  }
  if (ds.length > 0) { bs.push(ds); }
  return bs;
};

return beats;
});
