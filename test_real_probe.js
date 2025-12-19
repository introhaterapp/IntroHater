const { spawn } = require('child_process');
const path = require('path');
let ffprobePath = 'ffprobe';

try {
    ffprobePath = require('ffprobe-static').path;
} catch (e) {
    // Fallback
}

// URL from user logs
const url = "https://lax3-4.download.real-debrid.com/d/RONWE4S2HN5TC74/Game.of.Thrones.S02E02.480p.mkv";
const startTime = 90;

const args = [
    '-read_intervals', `${startTime}%+30`,
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pos,pts_time',
    '-show_packets',
    '-v', 'debug', // Verbose debug
    '-of', 'json',
    url
];

console.log(`Spawning ffprobe for ${url}...`);
const proc = spawn(ffprobePath, args);

let stdout = '';
let stderr = '';

proc.stdout.on('data', (data) => stdout += data);
proc.stderr.on('data', (data) => stderr += data);

proc.on('close', (code) => {
    console.log(`Exit Code: ${code}`);
    if (code !== 0) {
        console.log("STDERR:", stderr);
    }

    try {
        const data = JSON.parse(stdout);
        console.log(`Packets found: ${data.packets ? data.packets.length : 0}`);
        if (data.packets && data.packets.length > 0) {
            console.log("First packet:", data.packets[0]);
        } else {
            console.log("STDERR (even if code 0):", stderr);
        }
    } catch (e) {
        console.log("JSON Parse Error. Stdout:");
        console.log(stdout.substring(0, 500) + "...");
    }
});
