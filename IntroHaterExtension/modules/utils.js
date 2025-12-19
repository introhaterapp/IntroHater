// Base URL for API endpoints
const API_BASE_URL = 'https://introhater.com';

export { API_BASE_URL };

// Removed API key from source code for security reasons
export const API_KEY = process.env.API_KEY || ''; // API key should be loaded from environment variables

// Add nonce generation function
export function generateNonce(length = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Authentication state management functions
export function generateState(length = 32) {
  return generateNonce(length);
}

export function storeState(state) {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('auth_state', state);
    return true;
  }
  return false;
}

export function retrieveState() {
  if (typeof sessionStorage !== 'undefined') {
    const state = sessionStorage.getItem('auth_state');
    sessionStorage.removeItem('auth_state'); // Use once and remove
    return state;
  }
  return null;
}

export function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00:00";
  let date = new Date(null);
  date.setSeconds(seconds);
  return date.toISOString().substr(11, 8);
}

export function parseTime(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return NaN;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return NaN;
  return hours * 3600 + minutes * 60 + seconds;
}

export function getVideoIdFromURL(url) {  
  if (!url) return null;
  
  try {
    // For stremio:// protocol URLs
    if (url.includes('stremio://')) {
      const stremioMatch = url.match(/stremio:\/\/([^/]+)/);
      if (stremioMatch) {
        const decodedId = decodeURIComponent(stremioMatch[1]).trim();
        // Extract IMDB ID if it's embedded in the stremio URL
        const imdbMatch = decodedId.match(/tt\d+/);
        return imdbMatch ? imdbMatch[0] : decodedId;
      }
    }

    // For web player URLs (new format)
    if (url.includes('web.stremio.com/#/player/')) {
      // First try to extract from the path directly
      const pathMatch = url.match(/\/player\/[^/]+\/movie\/(tt\d+)/);
      if (pathMatch) {
        return pathMatch[1];
      }

      // If not found in path, try to extract from encoded parameters
      const encoded = url.split('/player/')[1];
      if (encoded) {
        try {
          const decoded = decodeURIComponent(encoded);
          const imdbMatch = decoded.match(/movie\/(tt\d+)/);
          if (imdbMatch) {
            return imdbMatch[1];
          }
        } catch {
          // Ignore decoding errors
        }
      }
    }

    // For web URLs, first check for movie URLs (handle multiple formats)
    const moviePatterns = [
      /movie\/([^/]+)\/([^/?#]+)/, // Standard format
      /movie\/([^/?#]+)/, // Simple format
      /\/([^/?#]+)\/watch/ // Alternative format
    ];

    for (const pattern of moviePatterns) {
      const matches = url.match(pattern);
      if (matches) {
        // Try to find an IMDB ID in any of the captured groups
        for (const group of matches) {
          if (!group) continue;
          const imdbId = group.match(/tt\d+/)?.[0];
          if (imdbId) return imdbId;
        }
        // If no IMDB ID found, try the last captured group
        return decodeURIComponent(matches[matches.length - 1]).trim();
      }
    }

    // For series URLs
    const seriesRegex = /series\/([^/]+)\/([^/?#]+)/;
    const seriesMatches = url.match(seriesRegex);
    if (seriesMatches) {
      const [, seriesId, episodeInfo] = seriesMatches;
      // Check if it's already in the correct format (tt123:1:2)
      if (episodeInfo.match(/tt\d+:\d+:\d+/)) {
        return decodeURIComponent(episodeInfo).trim();
      }
      
      // Try to extract IMDB ID and episode info
      const imdbId = seriesId.match(/tt\d+/)?.[0];
      if (imdbId) {
        // Try to extract season and episode numbers
        const epMatch = episodeInfo.match(/(\d+):(\d+)$/);
        if (epMatch) {
          const [, season, episode] = epMatch;
          return `${imdbId}:${season}:${episode}`;
        }
      }
      return decodeURIComponent(episodeInfo).trim();
    }

    // For other URLs, try to find any valid video ID format in the fragment
    if (url.includes('#')) {
      const hashPart = url.split('#')[1];
      // Look for tt ID with season/episode for series
      const ttSeriesMatch = hashPart.match(/tt\d+:\d+:\d+/);
      if (ttSeriesMatch) {
        return ttSeriesMatch[0];
      }
      
      // Look for simple tt ID for movies
      const ttMovieMatch = hashPart.match(/tt\d+/);
      if (ttMovieMatch) {
        return ttMovieMatch[0];
      }
      
      // Try to extract from other URL formats
      const decodedHash = decodeURIComponent(hashPart).trim();
      const idMatch = decodedHash.match(/tt\d+(?::\d+:\d+)?/);
      if (idMatch) {
        return idMatch[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}