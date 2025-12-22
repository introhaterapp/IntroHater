import { API_KEY } from './utils.js';

export function dumpVideoElement(video) {
  if (!video) return 'No video element provided';
  try {
    return {
      src: video.src || 'no src',
      currentSrc: video.currentSrc || 'no currentSrc',
      readyState: video.readyState,
      paused: video.paused,
      duration: video.duration || 0,
      videoWidth: video.videoWidth || 0,
      videoHeight: video.videoHeight || 0,
      hasChildNodes: video.hasChildNodes(),
      parentNode: video.parentNode ? video.parentNode.tagName : 'none',
      attributes: Array.from(video.attributes).map(attr => `${attr.name}="${attr.value}"`)
    };
  } catch (e) {
    return 'Error dumping video element';
  }
}

export function findPlayer(callback) {
  let attempts = 0;
  const maxAttempts = 40;

  function searchForPlayer() {
    if (attempts >= maxAttempts) {
      return;
    }

    const selectors = [
      'video',
      '.player-container video',
      '[class*="player"] video',
      '#stremio-player video',
      '.stremio-video video',
      '[data-video-player] video'
    ];

    let foundVideos = [];
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      foundVideos = [...foundVideos, ...elements];
    });
    if (foundVideos.length > 0) {
      foundVideos.forEach((video, index) => {
      });

      const validPlayer = foundVideos.find(video =>
        video instanceof HTMLVideoElement &&
        (video.readyState > 0 || video.src || video.querySelector('source'))
      );

      if (validPlayer) {
        callback(validPlayer);
        return;
      }
    }

    attempts++;
    setTimeout(searchForPlayer, 1000);
  }

  searchForPlayer();
}

export async function checkAndSkip(player, skipSegments, isEnabled, showSkipNotification) {
  if (!isEnabled || !player || skipSegments.length === 0) {
    return false;
  }

  try {
    const currentTime = player.currentTime;
    for (const segment of skipSegments) {
      // Increased the detection window slightly and added bounds checking
      const isApproachingSegment = (
        currentTime >= (segment.start - 1.0) &&
        currentTime < segment.end &&
        segment.start >= 0 &&
        segment.end > segment.start &&
        segment.end <= player.duration
      );

      if (isApproachingSegment) {
        player.currentTime = segment.end;
        await showSkipNotification(segment);
        return { skipped: true, duration: segment.end - segment.start };
      }
    }
  } catch (error) {
    console.error('Error in checkAndSkip:', error);
  }
  return { skipped: false };
}

const MAL_CACHE = {};

async function getMalId(imdbId, type = 'tv') {
  if (MAL_CACHE[imdbId]) return MAL_CACHE[imdbId];
  try {
    const metaRes = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
    const metaData = await metaRes.json();
    const name = metaData?.meta?.name;

    if (!name) return null;
    console.log(`IntroHater: Searching matches for "${name}"...`);

    const jikanRes = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(name)}&type=${type}&limit=1`);
    const jikanData = await jikanRes.json();

    if (jikanData?.data?.[0]?.mal_id) {
      const malId = jikanData.data[0].mal_id;
      console.log(`IntroHater: Mapped ${name} -> MAL ${malId}`);
      MAL_CACHE[imdbId] = malId;
      return malId;
    }
  } catch (e) {
    // console.warn("IntroHater: Auto-map failed", e);
  }
  return null;
}

async function fetchAniskip(malId, episode) {
  try {
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&episodeLength=0`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.found && data.results) {
      return data.results
        .filter(r => r.interval)
        .map(r => ({
          start: r.interval.startTime,
          end: r.interval.endTime,
          label: r.skipType === 'op' ? 'Intro' : 'Ending',
          isAniskip: true
        }));
    }
  } catch (e) { }
  return [];
}

export async function fetchSkipSegments(videoId, API_BASE_URL, visualizer) {
  if (!videoId) {
    return [];
  }

  let segments = [];

  // 1. Try fetching from IntroHater API (Local/DB)
  try {
    const response = await fetch(`${API_BASE_URL}/api/segments/${encodeURIComponent(videoId)}`, {
      headers: {
        'X-API-Key': API_KEY
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        segments.push(...data);
      }
    }
  } catch (error) {
    console.warn('IntroHater: Main API failed', error);
  }

  // 2. Try fetching from Aniskip (if it looks like a series)
  try {
    // Check if videoId is in format tt12345:1:1
    const seriesMatch = videoId.match(/^(tt\d+):(\d+):(\d+)$/);
    if (seriesMatch) {
      const [_, imdbId, season, episode] = seriesMatch;
      // Aniskip logic mainly useful for anime, so we try to map it
      const malId = await getMalId(imdbId, 'tv');
      if (malId) {
        const aniSkips = await fetchAniskip(malId, episode);
        if (aniSkips.length > 0) {
          console.log('IntroHater: Found Aniskip segments', aniSkips);
          segments.push(...aniSkips);
        }
      }
    }
  } catch (e) {
    console.warn('IntroHater: Aniskip check failed', e);
  }


  try {
    if (visualizer) {
      // Clear visualization first
      visualizer.clear();

      // Initialize visualization if we have valid segments
      if (segments.length > 0) {
        const slider = document.querySelector('.slider-container-nJz5F');
        if (slider) {
          // Sort segments by start time to ensure consistent visualization
          segments.sort((a, b) => a.start - b.start);

          // Wait for metadata to load before visualizing
          await new Promise((resolve) => {
            const maxAttempts = 50; // 5 seconds total
            let attempts = 0;

            const checkReady = () => {
              const player = document.querySelector('video');
              if (!player) {
                resolve();
                return;
              }

              if (player.readyState >= 1 && player.duration > 0) {
                resolve();
              } else {
                attempts++;
                if (attempts >= maxAttempts) {
                  resolve();
                  return;
                }
                setTimeout(checkReady, 100);
              }
            };
            checkReady();
          });

          // Add each segment to visualization
          for (const segment of segments) {
            if (segment && typeof segment.start === 'number' && typeof segment.end === 'number') {
              await visualizer.setStartTime(segment.start);
              await visualizer.setEndTime(segment.end);
            }
          }
        }
      }
    }

    return segments;
  } catch (error) {
    if (visualizer) {
      visualizer.clear();
    }
    return segments; // Return whatever segments we found even if visualization failed
  }
}

// Add a function to help with visualization initialization
export function initializeVisualization(player, createVisualizer) {
  return new Promise((resolve) => {
    const maxAttempts = 20;
    let attempts = 0;

    function tryInit() {
      const slider = document.querySelector('.slider-container-nJz5F');
      if (!slider || !player) {
        if (attempts < maxAttempts) {
          attempts++;
          setTimeout(tryInit, 250);
        } else {
          resolve(null);
        }
        return;
      }

      // Make sure player has duration
      if (!player.duration && attempts < maxAttempts) {
        attempts++;
        setTimeout(tryInit, 250);
        return;
      }

      const visualizer = createVisualizer(player, slider);
      resolve(visualizer);
    }

    tryInit();
  });
}