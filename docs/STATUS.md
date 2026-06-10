# IntroHater - Status & Roadmap

> Last updated: June 2026 — v2.1.0

## Architecture (v2.1.0)

Intro skip uses **HLS byte-range manifests only** (`/hls/manifest.m3u8` → ffprobe → `generateSmartManifest`).

- Debrid m3u8 playlist patching is **not** used for skip (does not work in Stremio)
- MKV blocks byte-range skip on TV/Web (ExoPlayer/HLS.js container limitation)
- MP4 sources may support skip on all clients (device testing ongoing)

## Platform Compatibility Matrix

| Platform | MKV source | MP4 source |
|----------|------------|------------|
| Desktop (Win/Mac/Linux) | Skip ✅ Playback ✅ | Skip ✅ Playback ✅ |
| iOS | Skip ✅ Playback ✅ | Skip ✅ Playback ✅ |
| Web Stremio | Playback ✅ / Skip ❌ | Skip ✅ (testing) |
| Android / Android TV | Playback ✅ via Direct stream / Skip ❌ | Skip ✅ (testing) |
| Fire Stick / Fire TV | Playback ✅ via Direct stream / Skip ❌ | Skip ✅ (testing) |
| Samsung Tizen / LG webOS | Playback ✅ via Direct stream / Skip ❌ | Skip ✅ (testing) |

## What Works in v2.1.0

| Feature | Status |
|---------|--------|
| HLS byte-range intro skip (desktop) | ✅ Working |
| Dual streams for TV (Skip + Direct) | ✅ New |
| Container-aware routing (MKV vs MP4) | ✅ New |
| MP4 file preference from debrid | ✅ New |
| Proxy URL resolution (StremThru/Comet) | ✅ Fixed (#10) |
| AIOStreams config (base64url) | ✅ Fixed (#11) |
| TheIntroDB segment source | ✅ New (#14) |
| TorBox/Android TV crash/loop | ✅ Fixed (#5, #18) |
| Desktop libVLC fallback | ✅ Fixed (#13) |

## TV/Mobile Usage

When skip data exists for MKV content, IntroHater returns two streams:

1. **🎯 Skip** — HLS byte-range (best on desktop)
2. **📺 Direct** — Original debrid URL (playback on TV, no skip)

Select **Direct** on Android TV / Fire Stick for MKV torrents.

## Known Limits

- **MKV-only torrents cannot auto-skip on TV/mobile** without server remux or Stremio native skip
- Most debrid content is MKV — dual-stream is the honest workaround
- MP4 torrents may get full skip on TV (requires device validation)

## Segment Sources

1. Community database (MongoDB)
2. IntroDB (`api.introdb.app/intro`)
3. TheIntroDB (`api.introdb.app/segments`) — intro, recap, credits, preview
4. Ani-Skip / Anime-Skip (anime)
5. FFprobe chapter discovery (fallback)
