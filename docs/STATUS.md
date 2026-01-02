# IntroHater - Status & Roadmap

> Last updated: January 2, 2026

## ✅ What Works Now

### Desktop Stremio (Windows, macOS, Linux)
| Feature | Status |
|---------|--------|
| Stream discovery via AIOstreams | ✅ Working |
| Multi-debrid (RD, TorBox, Premiumize, AllDebrid) | ✅ Working |
| Intro skip (HLS proxy) | ✅ Working |
| Skip segment lookup | ✅ Working |
| Proxy stream pass-through | ✅ Working |

### iOS Stremio
| Feature | Status |
|---------|--------|
| Playback | ✅ Working |
| Intro skip | ✅ Working (with external player like VLC) |

---

## ⚠️ Known Issues

### Web Stremio (web.stremio.com, app.strem.io)
| Issue | Root Cause |
|-------|------------|
| HLS skip manifests don't play | Web Stremio uses HLS.js which **cannot decode MKV containers** |
| Black screen / frozen video | Byte-range requests on MKV files fail in browser |
| "Stream not supported" | Codec incompatibility (HEVC, TrueHD, DTS-HD) |

### Android TV / Google TV
| Issue | Root Cause |
|-------|------------|
| Same as Web Stremio | Uses ExoPlayer which has limited MKV/HEVC support |
| Intermittent playback | HLS manifests with `EXT-X-DISCONTINUITY` cause decoder issues |

---

## 🧪 What We've Tried

### Approach 1: Direct 302 Redirect
**Tried:** Redirect to original stream URL instead of generating HLS manifest  
**Result:** ❌ Playback works but skips don't happen  

### Approach 2: Pass-through Manifest (No Byte-Ranges)
**Tried:** Generate simple HLS manifest without byte-range segments  
**Result:** ❌ Still fails on MKV containers  

### Approach 3: Remove EXT-X-DISCONTINUITY Tags
**Tried:** Generate continuous manifest without discontinuity markers  
**Result:** ❌ Decoder still can't handle MKV byte-ranges  

### Approach 4: Increase Header Size
**Tried:** Use larger initial segment (10MB+) to include more codec info  
**Result:** ❌ Still fails - fundamental container incompatibility  

### Approach 5: Hybrid Routing (Current)
**Tried:** Only route streams with skip segments through HLS; pass others directly  
**Result:** ✅ Playback fixed for no-skip content; skips work on desktop only  

---

## 🔬 Technical Root Cause

```
Web/Android Stremio Player Stack:
┌─────────────────────────┐
│     Stremio UI          │
├─────────────────────────┤
│   HLS.js / ExoPlayer    │  ← Only supports MPEG-TS and fMP4 segments
├─────────────────────────┤
│     Video Decoder       │  ← Limited codec support in browser/Android
└─────────────────────────┘

IntroHater HLS Manifests:
┌─────────────────────────┐
│   .m3u8 with byte-range │
│   pointing to .mkv file │  ← MKV container is NOT supported by HLS.js
└─────────────────────────┘
```

**The only real fix would be server-side remuxing (MKV → MPEG-TS)**, which requires:
- FFmpeg on the server
- Significant CPU/bandwidth resources
- Per-stream transcoding overhead

---

## 🗺️ Roadmap / Possible Solutions

### Option A: Accept Desktop-Only Skip Support
**Effort:** None (current state)  
**Trade-off:** Web/Android users get playback but no intro skipping

### Option B: Client-Side Skip Overlay
**Effort:** Medium  
**Approach:** Instead of HLS manipulation, show a "Skip Intro" button overlay  
**Challenge:** Requires Stremio plugin/extension support (not currently available)

### Option C: Server-Side Remuxing
**Effort:** High  
**Approach:** Use FFmpeg to remux MKV → MPEG-TS on-the-fly  
**Challenge:** 
- High CPU usage per stream
- Increased server costs
- Latency on playback start

### Option D: Seek-Based Skip (No HLS)
**Effort:** Medium  
**Approach:** Pass original stream, inject seek command at intro timestamp  
**Challenge:** Stremio doesn't support injecting seek commands from addons

### Option E: External Player Recommendation
**Effort:** Low  
**Approach:** Detect Web/Android and show message recommending VLC/external player  
**Trade-off:** Worse UX but actually works

---

## 📊 Platform Compatibility Matrix

| Platform | Playback | Intro Skip | Notes |
|----------|----------|------------|-------|
| Desktop (Win/Mac/Linux) | ✅ | ✅ | Full support |
| iOS (VLC) | ✅ | ✅ | Via external player |
| iOS (Native) | ✅ | ⚠️ | Limited codec support |
| Android (VLC) | ✅ | ✅ | Via external player |
| Android TV | ✅ | ❌ | ExoPlayer MKV issues |
| Google TV | ✅ | ❌ | ExoPlayer MKV issues |
| Web Stremio | ✅ | ❌ | HLS.js MKV issues |
| Samsung Tizen | ✅ | ❓ | Untested |
| LG WebOS | ✅ | ❓ | Untested |

---

## 📝 Decision Needed

**Recommended approach:** Start with **Option E** (detect problematic clients and recommend external player), then evaluate if **Option C** (remuxing) is worth the infrastructure cost.

To implement Option E, we would:
1. Detect User-Agent for Web/Android clients
2. For skip-enabled content, show a message like "For intro skipping, use VLC player"
3. Provide both skip-enabled and direct stream options
