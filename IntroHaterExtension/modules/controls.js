import { API_BASE_URL, generateNonce, API_KEY } from './utils.js';
import { getUserCredentials, checkAndRenewToken } from './auth.js';

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

export class SegmentUIController {
    constructor(player, onSegmentUpdate) {
        this.player = player;
        this.isAddingSegments = false;
        this.segmentOptionsActive = false;
        this.onSegmentUpdate = onSegmentUpdate;
        this.selectedType = 'intro';
        this.startTime = null;
        this.endTime = null;
    }

    createSegmentUI() {
        const toolbar = document.querySelector('[class^="control-bar-buttons-menu-container"]');
        if (!toolbar) return null;

        let container = document.getElementById('segment-ui-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'segment-ui-container';
            container.style.cssText = "display: flex; align-items: center; margin-left: 10px;";
            toolbar.insertBefore(container, toolbar.firstChild);
        }

        const initialButton = this.createInitialButton(container);
        this.addControlStyles();
        
        // Reset state when creating new UI
        this.startTime = null;
        this.endTime = null;
        this.isAddingSegments = false;
        this.segmentOptionsActive = false;
        
        return container;
    }

    createInitialButton(container) {
        let initialButton = document.getElementById('initial-segment-button');
        if (!initialButton) {
            initialButton = document.createElement('button');
            initialButton.id = 'initial-segment-button';
            initialButton.style.cssText = `
                background: none;
                border: none;
                padding: 0;
                cursor: pointer;
                display: flex;
                align-items: center;
                transition: transform 0.3s ease;
            `;
            initialButton.title = "Mark segment";
            initialButton.innerHTML = this.getInitialButtonSVG();
            container.appendChild(initialButton);

            initialButton.onclick = () => this.handleInitialButtonClick(initialButton);
        }
        return initialButton;
    }

    getInitialButtonSVG() {
        return `<svg class="control-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="10" r="5" fill="white"/>
            <circle cx="10" cy="22" r="5" fill="white"/>
            <circle cx="22" cy="22" r="5" fill="white"/>
        </svg>`;
    }

    handleInitialButtonClick(initialButton) {
        if (!this.segmentOptionsActive) {
            if (this.player) {
                this.isAddingSegments = true;
                this.startTime = this.player.currentTime;
                this.onSegmentUpdate('start', this.startTime);
                this.updateTimestampDisplay();
            }
            this.animateInitialButton(initialButton, true);
            this.showSegmentOptions(initialButton);
            this.segmentOptionsActive = true;
        } else {
            this.animateInitialButton(initialButton, false);
            this.clearSegmentOptions();
            this.segmentOptionsActive = false;
            this.isAddingSegments = false;
            this.startTime = null;
            this.endTime = null;
        }
    }

    showSegmentOptions(initialButton) {
        const container = document.getElementById('segment-ui-container');
        if (!container) return;

        let existingOptions = document.getElementById('segment-options-container');
        if (existingOptions) existingOptions.remove();

        const optionsContainer = document.createElement('div');
        optionsContainer.id = 'segment-options-container';
        optionsContainer.style.cssText = "display: flex; align-items: center; margin-right: 10px;";

        // Create timestamp display container
        const timestampDisplay = document.createElement('div');
        timestampDisplay.id = 'timestamp-display';
        timestampDisplay.style.cssText = `
            display: flex;
            align-items: center;
            margin-right: 16px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.8);
            font-family: monospace;
        `;
        
        // Initial timestamp text
        timestampDisplay.textContent = `Start: ${this.formatTime(this.startTime)} | End: ${this.formatTime(this.endTime)}`;
        
        const buttons = this.createOptionButtons(initialButton, optionsContainer);
        optionsContainer.appendChild(timestampDisplay);
        buttons.forEach(button => optionsContainer.appendChild(button));

        container.insertBefore(optionsContainer, initialButton);
    }

    createOptionButtons(initialButton, optionsContainer) {
        // First, create the type selector container
        const typeContainer = document.createElement('div');
        typeContainer.style.cssText = `
            display: flex;
            align-items: center;
            margin-right: 16px;
            position: relative;
        `;

        const segmentTypeMenu = document.createElement('select');
        segmentTypeMenu.style.cssText = `
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
            outline: none;
            -webkit-appearance: none;
            appearance: none;
            padding-right: 24px;

            &:hover {
                background: rgba(0, 0, 0, 0.9);
                border-color: rgba(255, 255, 255, 0.4);
            }
            
            &:focus {
                border-color: rgba(255, 255, 255, 0.5);
            }

            & option {
                background: black;
                color: white;
            }
        `;
        
        // Add dropdown arrow
        const arrow = document.createElement('div');
        arrow.style.cssText = `
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            pointer-events: none;
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-top: 4px solid white;
        `;
        
        const introOption = document.createElement('option');
        introOption.value = 'intro';
        introOption.textContent = 'Intro';
        const outroOption = document.createElement('option');
        outroOption.value = 'outro';
        outroOption.textContent = 'Outro';
        
        segmentTypeMenu.appendChild(introOption);
        segmentTypeMenu.appendChild(outroOption);
        
        segmentTypeMenu.addEventListener('change', (e) => {
            this.selectedType = e.target.value;
        });

        //typeContainer.appendChild(segmentTypeMenu);
        //typeContainer.appendChild(arrow);

        // Create the button group container
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            align-items: stretch;
            border-radius: 4px;
            margin-right: 4px;
            background: none;
            border: 1px solid rgba(255, 255, 255, 0.2);
            position: relative;
            width: fit-content;
        `;

        const endSegmentBtn = document.createElement('button');
        endSegmentBtn.id = 'end-segment-button';
        endSegmentBtn.textContent = 'End segment here';
        endSegmentBtn.style.cssText = `
            background: none;
            border: none;
            color: white;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s ease;
            margin: 0;
            white-space: nowrap;
            border-right: 1px solid rgba(255, 255, 255, 0.2);

            &:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            
            &:active {
                background: rgba(255, 255, 255, 0.1);
            }
            
            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;

        const submitBtn = document.createElement('button');
        submitBtn.id = 'submit-segment-button';
        submitBtn.textContent = 'Submit';
        submitBtn.style.cssText = `
            background: none;
            border: none;
            color: white;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s ease;
            display: none;
            margin: 0;
            white-space: nowrap;
            min-width: 70px;

            &:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            
            &:active {
                background: rgba(255, 255, 255, 0.1);
            }
            
            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;

        endSegmentBtn.addEventListener('click', () => {
            if (!this.player) return;
            
            if (!this.endTime) {
                this.endTime = this.player.currentTime;
                this.onSegmentUpdate('end', this.endTime);
                this.updateTimestampDisplay();
                endSegmentBtn.textContent = 'Cancel';
                submitBtn.style.display = 'block'; // Changed to block for better layout
            } else {
                this.clearSegmentOptions();
                this.animateInitialButton(initialButton, false);
                this.segmentOptionsActive = false;
            }
        });

        submitBtn.addEventListener('click', () => {
            this.handleSubmit(initialButton, optionsContainer);
        });

        buttonGroup.appendChild(endSegmentBtn);
        buttonGroup.appendChild(submitBtn);

        return [typeContainer, buttonGroup];
    }

    // Remove handleEndSegmentClick since we've moved the logic directly into the click event listener

    async handleSubmit(initialButton, optionsContainer) {
        if (this.startTime === null || this.endTime === null || !this.player) {
            return;
        }

        // Get and store videoId early
        const videoId = this.getVideoId();
        if (!videoId) {
            this.showErrorMessage('Could not determine video ID');
            return;
        }

        // Client-side validation
        const MIN_DURATION = 5;
        const MAX_DURATION = 300;
        const duration = this.endTime - this.startTime;

        if (duration < MIN_DURATION) {
            this.showErrorMessage(`Segment too short (${duration.toFixed(1)}s). Minimum is ${MIN_DURATION}s.`);
            return;
        }
        if (duration > MAX_DURATION) {
            this.showErrorMessage(`Segment too long (${duration.toFixed(1)}s). Maximum is ${MAX_DURATION}s.`);
            return;
        }

        try {
            let credentials = await getUserCredentials();
            if (!credentials?.userId || !credentials?.token || !credentials?.timestamp || !credentials?.nonce) {
credentials = await checkAndRenewToken();
                if (!credentials?.token) {
                    this.showErrorMessage('Could not authenticate. Please try again.');
                    return;
                }
            }

            // Disable buttons during submission
            const submitBtn = optionsContainer.querySelector('#submit-segment-button');
            const endSegmentBtn = optionsContainer.querySelector('#end-segment-button');
            if (submitBtn) submitBtn.disabled = true;
            if (endSegmentBtn) endSegmentBtn.disabled = true;

            // Generate nonce for this request
            const nonce = generateNonce();
            
            const makeRequest = async (creds) => {
                const payload = {
                    videoId,
                    start: Math.round(this.startTime), // Round to whole seconds
                    end: Math.round(this.endTime),
                    category: this.selectedType,
                    userId: creds.userId,
                    token: creds.token,
                    timestamp: typeof creds.timestamp === 'string' ? 
                        parseInt(creds.timestamp, 10) : creds.timestamp,
                    nonce // Use the newly generated nonce instead of the one from creds
                };
                return fetch(`${API_BASE_URL}/api/submit`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-API-Key': API_KEY
                    },
                    body: JSON.stringify(payload)
                });
            };

            // First attempt
            let response = await makeRequest(credentials);
            
            // If token is invalid, try to renew it and retry once
            if (response.status === 401 || response.status === 400) {
credentials = await checkAndRenewToken();
                
                if (credentials?.token) {
response = await makeRequest(credentials);
                } else {
                    throw new Error('Token renewal failed');
                }
            }

            if (response.ok) {
                const serverResponse = await response.json();
                if (serverResponse.success && serverResponse.stats) {
                    await browserAPI.storage.sync.set({ userStats: serverResponse.stats });
                }
                this.showSuccessMessage();
            } else {
                const error = await response.json();
                this.showErrorMessage(error.error || 'Failed to submit segment');
}
        } catch (error) {
this.showErrorMessage('Failed to submit segment');
        } finally {
            // Clear UI after submission attempt
            this.clearState();
            this.onSegmentUpdate('clear');
            optionsContainer.remove();
            this.animateInitialButton(initialButton, false);
            this.segmentOptionsActive = false;
        }
    }

    clearState() {
        this.startTime = null;
        this.endTime = null;
        this.isAddingSegments = false;
    }

    showSuccessMessage() {
        const message = document.createElement('div');
        message.textContent = 'Segment submitted successfully!';
        message.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(40, 167, 69, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 9999;
            transition: opacity 0.3s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(message);
        
        // Fade out animation
        setTimeout(() => {
            message.style.opacity = '0';
            setTimeout(() => message.remove(), 300);
        }, 2700);
    }

    showErrorMessage(error) {
        const message = document.createElement('div');
        message.textContent = error;
        message.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(220, 53, 69, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 9999;
            transition: opacity 0.3s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(message);
        
        // Fade out animation
        setTimeout(() => {
            message.style.opacity = '0';
            setTimeout(() => message.remove(), 300);
        }, 2700);
    }

    getVideoId() {
        const url = decodeURIComponent(window.location.href);
        console.log('Extracting video ID from URL:', url);
        try {
            // For Stremio web player URLs
            if (url.includes('web.stremio.com/#/player/')) {
                console.log('Detected Stremio web player URL');
                // Extract from encoded path
                const encoded = url.split('/player/')[1];
                if (encoded) {
                    try {
                        const decoded = decodeURIComponent(encoded);
                        console.log('Decoded player URL part:', decoded);
                        // Look for movie format first
                        const movieMatch = decoded.match(/movie\/(tt\d+)/);
                        if (movieMatch) {
                            console.log('Found movie ID:', movieMatch[1]);
                            return movieMatch[1];
                        }
                        // Then try series format
                        const seriesMatch = decoded.match(/tt\d+:\d+:\d+/);
                        if (seriesMatch) {
                            console.log('Found series ID:', seriesMatch[0]);
                            return seriesMatch[0];
                        }
                    } catch (decodeError) {
                        console.error('Error decoding URL part:', decodeError);
                    }
                }
            }

            // Fallback to other formats
            const match = url.match(/tt\d+:\d+:\d+/);
            if (match) {
                console.log('Found series ID in fallback:', match[0]);
                return match[0];
            }

            const imdbMatch = url.match(/tt\d+/);
            if (imdbMatch) {
                console.log('Found movie ID in fallback:', imdbMatch[0]);
                return imdbMatch[0];
            }

            console.log('No video ID found in URL');
            return null;
        } catch (error) {
            console.error('Error getting video ID:', error);
            return null;
        }
    }

    getButtonStyles() {
        return `
            background: none;
            border: 1px solid white;
            border-radius: 4px;
            color: white;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            transition: background-color 0.2s;
            
            &:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            &:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
    }

    animateInitialButton(button, opening) {
        const startRotation = opening ? '0deg' : '45deg';
        const endRotation = opening ? '45deg' : '0deg';
        
        // Add transform style to ensure smooth initial state
        button.style.transform = `rotate(${startRotation})`;
        
        const animation = button.animate(
            [
                { transform: `rotate(${startRotation})` },
                { transform: `rotate(${endRotation})` }
            ],
            { 
                duration: 200, 
                easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
                fill: 'forwards'
            }
        );
        
        // Update the final state after animation
        animation.onfinish = () => {
            button.style.transform = `rotate(${endRotation})`;
        };
    }

    addControlStyles() {
        if (!document.getElementById('segment-control-styles')) {
            const style = document.createElement('style');
            style.id = 'segment-control-styles';
            style.textContent = `.control-icon { width: 32px; height: 32px; }`;
            document.head.appendChild(style);
        }
    }

    clearSegmentOptions() {
        const optionsContainer = document.getElementById('segment-options-container');
        if (optionsContainer) optionsContainer.remove();
        this.clearState();
        this.onSegmentUpdate('clear');
    }

    destroy() {
        this.clearState();
        const container = document.getElementById('segment-ui-container');
        if (container) {
            const buttons = container.getElementsByTagName('button');
            for (let button of buttons) {
                button.replaceWith(button.cloneNode(true));
            }
            container.remove();
        }
    }

    formatTime(time) {
        if (time === null) return '--:--';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    updateTimestampDisplay() {
        const display = document.getElementById('timestamp-display');
        if (display) {
            display.textContent = `Start: ${this.formatTime(this.startTime)} | End: ${this.formatTime(this.endTime)}`;
        }
    }
}