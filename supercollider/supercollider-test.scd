// Test file for prototyping synths and effects

SynthDef("ping", {|bus=10,freq=440|
	Out.ar(bus, SinOsc.ar(freq));
}).add.asBytes.postcs();

SynthDef("dsaw", {|bus=10,freq=440,detune=0.1|
	var sig = Saw.ar(freq * (2 ** (0.0 * detune/12)))
	        + Saw.ar(freq * (2 ** (0.7 * detune/12)))
	        + Saw.ar(freq * (2 ** (1.0 * detune/12)));
	Out.ar(bus, sig);
}).add.asBytes.postcs();

SynthDef("lpf", {|bus=10,freq=440,q=10|
	ReplaceOut.ar(bus, RLPF.ar(In.ar(bus, 2), freq, 1/q));
}).add.asBytes.postcs();

SynthDef("simple-env", { |bus=10,amp=0.1,att=0.1,rel=1|
	ReplaceOut.ar(bus, In.ar(bus, 2) * EnvGen.kr(Env.perc(att, rel, amp, -2), doneAction: Done.freeGroup));
}).add.asBytes.postcs();

SynthDef("full-env", { |bus=10,amp=0.1,att=0.1,dec=0.1,sus=0.5,suslevel=0.8,rel=0.1|
	var env = Env([0, amp, amp*suslevel, amp*suslevel, 0], [att, dec, sus, rel], 0);
	ReplaceOut.ar(bus, In.ar(bus, 2) * EnvGen.kr(env, doneAction: Done.freeGroup));
}).add.asBytes.postcs();

SynthDef("mix-down", { |bus=10,out=0,amp=1| Out.ar(out, In.ar(bus, 2)*amp); }).add.asBytes.postcs();

SynthDef("echo", {|bus=10,out=0,echo=0.2,echotime=4|
	Out.ar(out, CombN.ar(In.ar(bus, 2), echo, echo, echotime));
}).add.asBytes.postcs();

~eb = Bus.audio(s);
Synth("echo",["bus",~eb,"out",0,"echo":1,"echotime":5]);

s.dumpOSC;
s.queryAllNodes;


s.makeBundle(0.2, {
	b = Bus.audio(s);
	g = Group.new(0,0);
	n = Synth("dsaw",["bus",b,"freq",440], g);
	l = Synth.after(n,"lpf", ["bus",b,"freq",500+1000.rand,"q",10], g);
	e = Synth.after(l,"full-env",["bus",b,"amp":0.2], g);
	m = Synth.after(e,"mix-down",["bus",b,"out":0,"amp",1], g); // dry mixdown
	Synth.after(m,"mix-down",["bus",b,"out":~eb,"amp",1], g); // mixdown to echo
});




{ CombN.ar(Decay.ar(Dust.ar(1,0.5), 0.2, WhiteNoise.ar), 0.2, 0.2, 3) }.play;




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
