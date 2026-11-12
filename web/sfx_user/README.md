# Drop-in sounds

Put real recordings here (wav / mp3 / ogg / flac), named exactly as below, then run `bash tools/fetch_sounds.sh`
(Claude does this). They are converted to `public/assets/sfx/<name>.ogg` and the game picks them up automatically.
A file here with the name of an existing sound (e.g. `oink1.wav`) replaces it.

| Name | What | Notes |
|---|---|---|
| `mower` | ride-on lawn mower engine | loopable, 5–10 s, steady idle/running |
| `cough` | a man coughing (2–3 coughs) | Bob in a fart cloud |
| `snore` | a man snoring (one breath) | Bob asleep |
| `yawn` | a man yawning | Bob waking up / out of breath |
| `bob_hey` | an angry farmer shouting "Hey!" / "Oi!" | Bob spots a pig |
| `wolf_howl` | a wolf howling | night wolves |
| `banjo` | a short cheerful banjo / fiddle jig | Bob's dance, 4–8 s |

Good free sources (check the license on each file): freesound.org (filter "Creative Commons 0"),
pixabay.com/sound-effects (Pixabay license, no attribution needed), Sonniss GDC Game Audio Bundles (royalty-free).
Add the source + license of every file to `public/assets/sfx/CREDITS.md` (the script lists them as "User-supplied").
