

(function () {
    'use strict';

    
    function getContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    
    const ICONS = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    
    function showToast(message, type = 'info', duration = 3000) {
        const container = getContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = ICONS[type] || ICONS.info;

        const text = document.createElement('span');
        text.className = 'toast-message';
        text.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => removeToast(toast);

        toast.appendChild(icon);
        toast.appendChild(text);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        
        requestAnimationFrame(() => {
            toast.classList.add('toast-visible');
        });

        
        if (duration > 0) {
            setTimeout(() => removeToast(toast), duration);
        }

        return toast;
    }

    function removeToast(toast) {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-hiding');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    
    window.Toast = {
        success: (msg, dur) => showToast(msg, 'success', dur),
        error: (msg, dur) => showToast(msg, 'error', dur),
        warning: (msg, dur) => showToast(msg, 'warning', dur),
        info: (msg, dur) => showToast(msg, 'info', dur),
        show: showToast
    };
})();
