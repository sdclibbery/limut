// Test file for prototyping synths and effects

SynthDef("ping", {|freq=440|
	Out.ar(0, SinOsc.ar(freq));
}).add.asBytes.postcs();

SynthDef("simpleEnv", { |out, att=0.5, amp=0.1, rel=1|
	ReplaceOut.ar(out, In.ar(out, 2) * EnvGen.kr(Env.perc(att, rel, amp, -4), doneAction: Done.freeGroup));
}).add.asBytes.postcs();

s.makeBundle(0.5, {
	g = Group.new;
	p = Synth("ping",["freq",440], g);
	Synth.after(p,"simpleEnv",["out",0,"att":0.1,"amp":0.2,"rel":2], g);
});

s.dumpOSC;

s.queryAllNodes;
