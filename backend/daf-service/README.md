# clario-daf

Static GitHub Pages host for the Clario DAF (Delayed Auditory Feedback) practice page.

## What this is

A single HTML page that uses the browser's **Web Audio API** `createDelay` node to play the user's microphone input back to their headphones with a configurable delay (50–250 ms).

**All audio processing is 100% on-device.** No audio is sent to any server. This is architecturally required because any network round-trip introduces uncontrollable variable latency that destroys the clinical precision of DAF.

## How it is used

The Flutter Clario app embeds this page in a `WebView` using the `webview_flutter` package. The URL used in the app is:

```
https://junaiddbz.github.io/clario-daf/
```

## Clinical notes

- Use **wired headphones only** — Bluetooth adds 100–300 ms of its own latency
- Typical clinical DAF range: **100–200 ms**
- Default: **150 ms**

## Hosting

Served via GitHub Pages from the `main` branch root.
