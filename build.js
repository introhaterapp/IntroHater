const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const EXTENSION_DIR = path.join(__dirname, 'IntroHaterExtension');
const DIST_DIR = path.join(__dirname, 'dist');
const CHROME_DIR = path.join(DIST_DIR, 'chrome');
const FIREFOX_DIR = path.join(DIST_DIR, 'firefox');

// Create necessary directories
[DIST_DIR, CHROME_DIR, FIREFOX_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Copy all files except manifest files
const filesToCopy = fs.readdirSync(EXTENSION_DIR)
    .filter(file => !file.startsWith('manifest'));

filesToCopy.forEach(file => {
    const source = path.join(EXTENSION_DIR, file);
    fs.copyFileSync(source, path.join(CHROME_DIR, file));
    fs.copyFileSync(source, path.join(FIREFOX_DIR, file));
});

// Copy the specific manifests
fs.copyFileSync(
    path.join(EXTENSION_DIR, 'manifest.chrome.json'), 
    path.join(CHROME_DIR, 'manifest.json')
);
fs.copyFileSync(
    path.join(EXTENSION_DIR, 'manifest.firefox.json'), 
    path.join(FIREFOX_DIR, 'manifest.json')
);

// Create zip files
const createZip = (sourceDir, targetName) => {
    return new Promise((resolve, reject) => {
        exec(`cd "${sourceDir}" && zip -r "${path.join(DIST_DIR, targetName)}" ./*`, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
};

Promise.all([
    createZip(CHROME_DIR, 'introhater-chrome.zip'),
    createZip(FIREFOX_DIR, 'introhater-firefox.zip')
])
.then(() => {
    // Clean up temp directories
    fs.rmSync(CHROME_DIR, { recursive: true });
    fs.rmSync(FIREFOX_DIR, { recursive: true });
})
.catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
});