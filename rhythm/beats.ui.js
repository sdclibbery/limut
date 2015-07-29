// User Interface adapter for beats

define(function (require) {
var metronome = require('rhythm/metronome');
var id = 1;

var make = function (info) {
  var values = info.values;
  var initial = info.initial;
  var myBeats = info.beats;
  var beatsUI = { lookup: values };

  id++;
  var markup = '<textarea id="beats" rows="9" cols="32" oninput="beatsUIChange'+id+'(this)">'+initial+'</textarea>';
  window['beatsUIChange'+id] = function (ta) {
    myBeats.values(parse(ta.value, beatsUI.lookup));
  };

  var html = '<div class="widget"><h5>beats</h5>'+markup+'</div>';
  document.body.innerHTML += html;

  myBeats.values(parse(initial, beatsUI.lookup));

  return beatsUI;
};

var parse = function (v, lookup) {
  var bs = [];
  var ds = [];
  for (var i = 0; i < v.length; i++) {
    var c = v[i];
    if (c === '\n') {
      bs.push(ds);
      ds = [];
    } else {
      ds.push(lookup[c]);
    }
  }
  if (ds.length > 0) { bs.push(ds); }
  return bs;
};

return make;
});
