// Test file for prototyping synths and effects

SynthDef("ping", {|bus=10,freq=440|
	Out.ar(bus, SinOsc.ar(freq));
}).add.asBytes.postcs();

SynthDef("simpleEnv", { |bus=10,amp=0.1, att=0.5, rel=1|
	Out.ar(0, In.ar(bus, 2) * EnvGen.kr(Env.perc(att, rel, amp, -2), doneAction: Done.freeGroup));
}).add.asBytes.postcs();

s.makeBundle(0.5, {
	var b = Bus.audio(s);
	var g = Group.new(0,0);
	var s = Synth("ping",["bus",b,"freq",440], g);
	Synth.after(s,"simpleEnv",["bus",b,"att":0.1,"amp":0.2,"rel":2], g);
});

s.dumpOSC;

s.queryAllNodes;





SynthDef("simpleEnvNoDone", { |amp=0.1, att=0.5, rel=1|
	ReplaceOut.ar(0, In.ar(0, 2) * EnvGen.kr(Env.perc(att, rel, amp, -2)));
}).add.asBytes.postcs();

p = ParGroup.new;

g = Group.new(p);
x = Synth("ping",["freq",660], g);
Synth.after(x,"simpleEnv",["out",0,"att":0.1,"amp":0.2,"rel":2], g);
h = Group.new(p);
y = Synth("ping",["freq",770], h);
Synth.after(y,"simpleEnv",["out",0,"att":0.1,"amp":0.2,"rel":2], h);

x = Synth("ping",["freq",660]);
Synth.after(x,"simpleEnvNoDone",["out",0,"att":0.1,"amp":0.2,"rel":2]);
y = Synth("ping",["freq",770]);
Synth.after(y,"simpleEnvNoDone",["out",0,"att":0.1,"amp":0.2,"rel":2]);

s.queryAllNodes;
