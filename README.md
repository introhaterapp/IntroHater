# IntroHater Lite

<div align="center">
  <img src="docs/icon32.png" alt="IntroHater Logo" width="128" height="128">
  
  **Universal Skip Intro for Stremio using Smart HLS Proxying.**
</div>

## Overview
IntroHater Lite is a specialized Stremio addon that automatically skips intros for movies and TV shows. Unlike traditional addons that rely on player seek-hints (which are often ignored), IntroHater **re-processes the video stream** into a custom HLS playlist, effectively splicing out the intro segment before it even reaches your player.

This ensures compatibility across almost all devices, including TVs (Android TV, Samsung Tizen, LG WebOS) and mobile apps.

## Features
*   **Smart HLS Proxying**: Converts streams to HLS and physically removes intro segments from the playback manifest.
*   **Universal Compatibility**: Works on any device that supports HLS playback (TVs, Mobile, Desktop).
*   **Real-Debrid Integration**: Fetches high-quality streams via Real-Debrid.
*   **Community Database**: Uses a growing database of skip segments.
*   **Fallback Mechanism**: If splicing fails, it gracefully falls back to the original stream.

## Installation

### Prerequisites
*   Node.js (v18 or higher)
*   **Real-Debrid Account**: Required for resolving cached streams.
*   **FFmpeg**: 
    *   **Windows**: Automatically handled via static binaries (included in dependencies).
    *   **Linux/Docker**: Must be installed on the system (`apt-get install ffmpeg`).

### Run Locally
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Rico-Rodriguez/IntroHater.git
    cd IntroHater
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the server**:
    ```bash
    npm start
    ```
    The server provides a local addon interface at `http://127.0.0.1:7005`.

### Configuration
1.  Navigate to `http://localhost:7005/docs/configure.html`.
2.  Enter your **Real-Debrid API Key**.
3.  Install the generated addon link into Stremio.

## How It Works
1.  **Intercept**: The addon intercepts your stream request.
2.  **Analyze**: It checks a database for known intro timestamps (start/end).
3.  **Proxy**: If an intro is found, it generates a custom `.m3u8` HLS playlist.
4.  **Splice**: This playlist instructs the player to play segments *before* the intro, then jump immediately to segments *after* the intro.

## License
MIT
