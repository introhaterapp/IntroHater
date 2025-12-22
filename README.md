# IntroHater

<div align="center">
  <img src="docs/icon32.png" alt="IntroHater Logo" width="128" height="128">
  
  **The Ultimate Skip Intro Addon for Stremio.**
  
  [![Stremio](https://img.shields.io/badge/Stremio-Addon-purple)](https://stremio.com)
  [![GitHub](https://img.shields.io/github/stars/introhaterapp/IntroHater?style=social)](https://github.com/introhaterapp/IntroHater)
</div>

## Overview
IntroHater is a powerful Stremio addon that automatically skips intros and outros for movies and TV shows. Unlike simple seeking scripts, IntroHater uses **Smart HLS Proxying** to modify the video stream on the fly, physically removing unwanted segments before they reach your player.

This technique ensures **100% compatibility** with:
- **TVs**: Android TV, Samsung Tizen, LG WebOS
- **Mobile**: Android & iOS (via VLC/Outplayer)
- **Desktop**: Stremio PC/Mac

## Features
*   **⚡ Smart HLS Proxying**: Converts streams to HLS and stitches content to skip intros seamlessly.
*   **🧠 Multiple skip Sources**:
    *   **Community Database**: Custom database of user-submitted skips.
    *   **Ani-Skip Integration**: Uses the vast 150k+ library of Anime-Skip.
    *   **Chapter Detection**: Automatically detects "Intro" chapters in file metadata as a fallback.
*   **🔗 Real-Debrid Powered**: stream high-quality content directly from Real-Debrid.
*   **📊 Leaderboard & Stats**: Track your time saved and contribute to the community.

## Installation

### For Users
Simply visit [IntroHater.com](https://introhater.com) to configure and install the addon.

### For Developers (Run Locally)
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/introhaterapp/IntroHater.git
    cd IntroHater
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Setup Environment**:
    Copy `.env.example` to `.env` and fill in optional keys (OMDB_API_KEY, ADMIN_PASSWORD).
    ```bash
    cp .env.example .env
    ```
4.  **Start the server**:
    ```bash
    npm start
    ```
    The server will run on `http://127.0.0.1:7005`.

## Architecture
IntroHater operates as a middleware between Stremio/Real-Debrid and your video player:
1.  **Intercept**: Stremio requests a stream from IntroHater.
2.  **Resolve**: IntroHater resolves the link via Real-Debrid.
3.  **Analyze**: It checks its internal DB, Ani-Skip, and finally the video file itself (ffmpeg probe) for skip timestamps.
4.  **Proxy**: It generates a dynamic `.m3u8` playlist that instructs the player to play `0:00 -> IntroStart` and then jump to `IntroEnd -> Finish`.

## Contributing
We welcome contributions! Please open an issue or submit a PR on [GitHub](https://github.com/introhaterapp/IntroHater).

## License
MIT
