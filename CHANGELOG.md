# Changelog

All notable changes to the "IntroHater" project will be documented in this file.

## [Unreleased]
### Added
- **Ani-Skip Integration**: Now fetches skip segments from the massive Anime-Skip database (150k+ episodes).
- **Chapter Detection**: Automatic fallback to detect "Intro" or "Opening" chapters embedded in video files.
- **Improved Stats**: Leaderboard and main page now show combined stats from local community, Ani-Skip, and chapter detections.
- **Reporting System**: Users can now report incorrect segments directly from the dashboard.

### Fixed
- **Mobile Display**: Fixed issues where stats and catalog were not loading correctly on mobile devices.
- **Auth Validation**: Hardened Real-Debrid key validation during token generation.
- **Segment Merging**: Improved logic to merge overlapping skip segments in the catalog.

## [1.0.0] - 2025-01-20
### Initial Release
- Core HLS Proxy functionality.
- Real-Debrid integration.
- Basic Community Database.
- Web Configuration Portal.
