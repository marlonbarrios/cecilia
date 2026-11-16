# Cecilia

Talk → words appear (white Helvetica on black) → break them into letters with your hands.

## Run

```
cd ~/Desktop/Cecilia
python3 serve.py
```

Open http://localhost:8123 in Chrome and allow camera + microphone.
(It must be served from localhost; opening index.html directly won't get camera/mic access.)

## Install as a Chrome app

1. With the server running, open http://localhost:8123 in Chrome.
2. Click the install icon at the right end of the address bar (a screen with a down arrow),
   or ⋮ menu → Cast, save and share → Install page as app.
3. Cecilia gets its own window, Dock icon and Launchpad entry. After the first full load it also
   opens without the server (files are cached by `sw.js`).

Or double-click **Start Cecilia.command**: it starts the server if needed and opens Cecilia in an app window.

## Controls

- **Hold SPACE**: talk. Words appear live while you speak (slightly dimmer while still being heard) and settle when you let go. Whisper base runs locally in the browser, on WebGPU when available. First load downloads ~80 MB.
- **Pinch on a word**: break it into letters and grab one
- **Pinch on a letter**: grab it; release the pinch to throw
- **Open palm, moving fast**: shatter words you sweep through, push loose letters
- **Fist (hold ~½ s)**: letters fly back into their words
- Mouse: click a word to break it, drag letters, double-click to rebuild
- Keys: T black / camera background · C camera preview on/off · L language (AUTO / English / Spanish / French) · M sound on/off · D diagnostics · R rebuild · S split all · X clear · H help

## Language

AUTO (default) detects English, Spanish or French each time you talk. To add more, extend `LANG_CODES` in `speech.js` (e.g. `italian: 'it'`, `german: 'de'`).

## Sound

Starts on your first key press or click (browsers require it). All in A minor pentatonic:
drone that opens up with your voice, a bell per new word, falling arpeggio when a word breaks,
a singing tone for each held letter (higher on screen = higher pitch), FM swarm for loose letters,
ticks on wall hits, a quiet hum per hand, wind for open-palm sweeps, rising chord on rebuild.

## Files

- `sketch.js`: p5 sketch (layout, letter physics, gestures)
- `speech.js`: Whisper speech-to-text via transformers.js, live partials, language detection
- `hands.js`: MediaPipe Hand Landmarker
- `sound.js`: Web Audio drones and interaction sounds
- `serve.py`: local server with caching off
- `test/`: spoken sample sentences used for testing
