const ffmpeg = require('fluent-ffmpeg');
try {
    const ffmpegPath = require('ffmpeg-static');
    const ffprobePath = require('ffprobe-static').path;
    console.log("FFmpeg Path:", ffmpegPath);
    console.log("FFprobe Path:", ffprobePath);

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
} catch (e) {
    console.error(e);
}

const url = "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

// Test with args
const startTime = 10;
ffmpeg.ffprobe(url, [
    '-read_intervals', `${startTime}%+10`,
    '-show_packets'
], (err, data) => {
    if (err) {
        console.error("FFprobe Args Error:", err);
    } else {
        console.log("FFprobe Args Success");
    }
});
