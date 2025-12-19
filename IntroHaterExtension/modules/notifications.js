import { API_BASE_URL, generateNonce, API_KEY } from './utils.js';
import { getUserCredentials, handleTokenError, checkAndRenewToken } from './auth.js';

export function showMarkerNotification(x, y, message) {
  let notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    z-index: 9999;
    transition: opacity 0.3s;
    transform: translate(-50%, -100%);
    pointer-events: none;
  `;
  notification.innerHTML = `
    <div style="position: relative;">
      ${message}
      <div style="
        position: absolute;
        bottom: -12px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid rgba(0, 0, 0, 0.8);
      "></div>
    </div>
  `;
  
  notification.style.left = x + 'px';
  notification.style.top = (y - 10) + 'px';
  
  document.body.appendChild(notification);
  
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });
  
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 2000);
}

export async function showSkipNotification(segment) {
  const player = document.querySelector('video');
  if (!player) return;
  
  const credentials = await getUserCredentials();
  const hasVoted = credentials ? hasVotedOnSegment(segment, credentials.userId) : false;
  
  const slider = document.querySelector('.slider-container-nJz5F');
  if (!slider) return;

  const track = slider.querySelector('.track-gItfW');
  if (!track) return;

  const trackRect = track.getBoundingClientRect();
  const currentTimePercent = (player.currentTime / player.duration) * 100;
  const x = trackRect.left + (trackRect.width * (currentTimePercent / 100));
  const y = trackRect.top;

  let notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    z-index: 9999;
    transition: opacity 0.3s;
    transform: translate(-50%, -100%);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  `;

  const contentWrapper = document.createElement('div');
  contentWrapper.style.position = 'relative';
  contentWrapper.textContent = `Skipped Segment`;

  const arrowTip = document.createElement('div');
  arrowTip.style.cssText = `
    position: absolute;
    bottom: -24px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid rgba(0, 0, 0, 0.8);
  `;
  contentWrapper.appendChild(arrowTip);
  notification.appendChild(contentWrapper);

  if (segment.id && !hasVoted && credentials) {
    const buttonsDiv = await createVoteButtons(segment, notification);
    if (buttonsDiv) {
      notification.appendChild(buttonsDiv);
    }
  }

  notification.style.left = x + 'px';
  notification.style.top = (y - 10) + 'px';
  
  document.body.appendChild(notification);
  
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
  });

  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
}

async function createVoteButtons(segment, notification) {
  // Check if user owns this segment
  const credentials = await getUserCredentials();
  if (!credentials || segment.submittedBy === credentials.userId) {
    return null; // Don't create vote buttons for own segments
  }

  const buttonsDiv = document.createElement('div');
  buttonsDiv.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
  `;

  const thumbsUpSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <path d="M14,9V5c0-1.7-1.3-3-3-3h0c-0.5,0-1,0.4-1,1v4L7,13v8h8.8c0.7,0,1.3-0.5,1.5-1.2l1.5-6c0.3-1.1-0.6-2.2-1.7-2.2H14z"/>
    <path d="M7,13H4c-0.6,0-1,0.4-1,1v7c0,0.6,0.4,1,1,1h3"/>
  </svg>`;

  const thumbsDownSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <path d="M10,15v4c0,1.7,1.3,3,3,3h0c0.5,0,1-0.4,1-1v-4l3-6V3H8.2C7.5,3,6.9,3.5,6.7,4.2l-1.5,6C4.9,11.3,5.8,12.4,6.9,12.4H10z"/>
    <path d="M17,11h3c0.6,0,1-0.4,1-1V3c0-0.6-0.4-1-1-1h-3"/>
  </svg>`;

  const thumbsUpButton = createVoteButton(thumbsUpSvg, () => handleVote(1, segment, notification));
  const thumbsDownButton = createVoteButton(thumbsDownSvg, () => handleVote(-1, segment, notification));

  buttonsDiv.appendChild(thumbsUpButton);
  buttonsDiv.appendChild(thumbsDownButton);

  return buttonsDiv;
}

function createVoteButton(svg, onClick) {
  const button = document.createElement('button');
  button.style.cssText = `
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 8px;
    border-radius: 4px;
  `;
  button.innerHTML = svg;
  button.addEventListener('click', onClick);
  return button;
}

export function hasVotedOnSegment(segment, userId) {
  if (!segment || !userId) return false;
  return segment.userVotes && segment.userVotes[userId] !== undefined;
}

async function handleVote(vote, segment, notification) {
  try {
    const credentials = await getUserCredentials();
    if (!credentials) {
      throw new Error('No user credentials');
    }

    // Ensure we have valid credentials first
    const validCredentials = await checkAndRenewToken();
    if (!validCredentials) {
      throw new Error('Failed to get valid credentials');
    }

    const nonce = generateNonce();
    const response = await fetch(`${API_BASE_URL}/api/segments/${segment.id}/vote`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        vote,
        userId: validCredentials.userId,
        token: validCredentials.token,
        timestamp: Date.now(),
        nonce
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        const newCredentials = await handleTokenError({ status: 401 });
        if (newCredentials) {
          const retryNonce = generateNonce();
          const retryResponse = await fetch(`${API_BASE_URL}/api/segments/${segment.id}/vote`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': API_KEY
            },
            body: JSON.stringify({
              vote,
              userId: newCredentials.userId,
              token: newCredentials.token,
              timestamp: newCredentials.timestamp,
              nonce: retryNonce
            })
          });

          if (!retryResponse.ok) {
            throw new Error('Vote failed even after token refresh');
          }

          const serverResponse = await retryResponse.json();
          if (serverResponse.success && serverResponse.segment) {
            // Update the segment data in memory
            Object.assign(segment, serverResponse.segment);
          }
        } else {
          throw new Error('Failed to refresh token');
        }
      } else {
        throw new Error('Vote failed: ' + (await response.text()));
      }
    } else {
      const serverResponse = await response.json();
      if (serverResponse.success && serverResponse.segment) {
        // Update the segment data in memory
        Object.assign(segment, serverResponse.segment);
      }
    }
    
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
    
    showMarkerNotification(
      notification.offsetLeft,
      notification.offsetTop,
      'Feedback submitted successfully'
    );
  } catch (error) {
    console.error('Error submitting vote:', error);
    showMarkerNotification(
      notification.offsetLeft,
      notification.offsetTop,
      'Failed to submit feedback'
    );
  }
}