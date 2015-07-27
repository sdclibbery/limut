// User Interface adapter for beats

define(function (require) {
var metronome = require('rhythm/metronome');

var beats = {};
var myBeats;

beats.lookup = {
  k: 'kick',
  s: 'snare',
  o: 'openhat',
  c: 'closedhat'
};
var initial = 'kc\nsc\nkc\nsc';

var markup = '<textarea id="beats" rows="9" cols="32" oninput="beatsUIChange(this)">'+initial+'</textarea>';
window.beatsUIChange = function (ta) {
  myBeats.values(parse(ta.value));
};

var html = '<div class="widget"><h5>beats</h5>'+markup+'</div>';
document.body.innerHTML += html;

beats.target = function (beatsDomain) {
  myBeats = beatsDomain;
  myBeats.values(parse(initial));
};

var parse = function (v) {
  var bs = [];
  var ds = [];
  for (var i = 0; i < v.length; i++) {
    var c = v[i];
    if (c === '\n') {
      bs.push(ds);
      ds = [];
    } else {
      ds.push(beats.lookup[c]);
    }
  }
  if (ds.length > 0) { bs.push(ds); }
  return bs;
};

return beats;
});
