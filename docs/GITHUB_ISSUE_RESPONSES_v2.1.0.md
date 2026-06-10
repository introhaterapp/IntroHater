# GitHub Issue Responses — v2.1.0

Post these comments on the respective issues after deploying v2.1.0.

---

## [#5 — TorBox + Android TV streams don't play](https://github.com/introhaterapp/IntroHater/issues/5)

**Fixed in v2.1.0**

Root cause: TV clients were getting broken manifests (debrid m3u8 patch or MKV byte-range HLS), causing playback failure and auto-advance to the next episode.

**Changes:**
- Removed debrid m3u8 playlist patching as a skip path — it doesn't skip and breaks playback
- TV/mobile now gets a **📺 Direct** stream that plays without skip
- **🎯 Skip** stream (HLS byte-range) still available for desktop
- MKV on TV cannot auto-skip (ExoPlayer container limitation) — honest dual-stream approach

Please reinstall from the [configure page](https://introhater.com/configure.html) and select **Direct** on Android TV. Skip on MKV requires desktop or MP4 sources.

---

## [#10 — StremThru proxy + AIOStreams](https://github.com/introhaterapp/IntroHater/issues/10)

**Fixed in v2.1.0**

Proxy URLs (`/playback/`, StremThru) are now resolved to the underlying debrid direct link before the HLS skip engine runs. Skip works on desktop; TV gets a direct playback stream.

Please reinstall and test your self-hosted AIOStreams + StremThru setup.

---

## [#11 — AIOStreams config error](https://github.com/introhaterapp/IntroHater/issues/11)

**Fixed in v2.1.0**

Root cause: standard base64 in install links contains `/` characters that break the `stremio://` URL path, corrupting your scraper config.

**Action required:** Regenerate your install link from the configure page (old links will not work).

---

## [#13 — libVLC playback error](https://github.com/introhaterapp/IntroHater/issues/13)

**Fixed in v2.1.0**

Root cause: IntroHater was double-wrapping streams in broken manifests instead of using the standard HLS byte-range path.

Desktop now resolves to the direct debrid URL and runs a single HLS byte-range skip manifest — same path that already worked. libVLC fallback should no longer trigger.

---

## [#14 — TheIntroDB support](https://github.com/introhaterapp/IntroHater/issues/14)

**Implemented in v2.1.0**

IntroHater now queries TheIntroDB `GET /segments` for intro, recap, credits, and preview timestamps. Data is cached in our DB after first fetch.

Thanks for the suggestion!

---

## [#18 — TorBox 2hr audio / skip broken](https://github.com/introhaterapp/IntroHater/issues/18)

**Fixed in v2.1.0**

Root cause: TorBox transcode returned an m3u8 playlist that we tried to patch for skip — this doesn't skip in Stremio and caused wrong duration/audio-only playback.

**Changes:**
- Removed m3u8 patching entirely
- TorBox streams now resolve to direct download URL → HLS byte-range skip engine (desktop)
- TV/mobile: **Direct** stream for playback, no broken transcode manifest

Please reinstall and test. On TV, use the **Direct** stream; skip on MKV requires desktop.
