# Limut

Live coding music and visuals in the browser. Inspired by FoxDot with a desire to make it more accessible by running in any modern browser with no installation. Approach to visuals inspired by Crash Server's `video` player, and shadertoy :-)

# Documentation

Documentation (what there is of it) is available in the page itself, underneath the console; this includes a number of examples that can be copied into the editor and run.

# Try it

Try it at https://sdclibbery.github.io/limut/

Please report problems / bugs / browser issues etc as github issues at https://github.com/sdclibbery/limut/issues

# Electron app

Limut can be run as a website, or packaged into a desktop web app. With npm installed, run `npm install` to install electron, and then `npm start` to run the electron app. There are no prepackaged versions available at present.

# Code Editor

Limut uses the CodeMirror editor by default (https://codemirror.net). This provides syntax coloring. However, on some devices (eg mobile) a better experience may result from using a basic textarea editor; this can be enabled by using the `?textarea` url parameter.

# Development

Run locally by firing up `./server.sh` and connecting a browser to http://localhost:8000/?test . The unit tests run on page load when the `?test` url parameter is present; view output in the browser console.

# Samples

Piano sounds: https://archive.org/details/SalamanderGrandPianoV3

Limut's audio files have been copied from FoxDot (https://github.com/Qirky/FoxDot), where they were obtained from a number of sources. Here's a list of thanks for the unknowing creators of FoxDot's sample archive.

    Legowelt Sample Kits
    Game Boy Drum Kit
    A number of sounds courtesy of Mike Hodnick's live coded album, Expedition
    Many samples have been obtained from http://freesound.org and have been placed in the public domain via the Creative Commons 0 License: http://creativecommons.org/publicdomain/zero/1.0/ - thank you to the original creators
    Other samples have come from the Dirt Sample Engine which is part of the TidalCycles live coding language created by Yaxu - another huge amount of thanks.

If you feel I've used a sample where I shouldn't have, please get in touch!

# Shaders

Many shaders are based on ones from https://www.shadertoy.com/ , and the shadertoy synth uses the Shadertoy.com API to load shaders directly from shadertoy.
