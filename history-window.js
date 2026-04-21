const { ipcRenderer } = require('electron');

let allHistory = [];
let filteredHistory = [];

// Load history
async function loadHistory() {
    try {
        allHistory = await ipcRenderer.invoke('get-history');
        filteredHistory = [...allHistory];
        renderHistory();
        updateStats();
    } catch (error) {
        console.error('Failed to load history:', error);
    }
}

// Render history list
function renderHistory() {
    const listEl = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');

    if (filteredHistory.length === 0) {
        listEl.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    const modeNames = {
        'transcribe': '转写模式',
        'translate': '翻译模式',
        'dual': '双语模式'
    };

    listEl.innerHTML = filteredHistory.map((item, index) => {
        const date = new Date(item.timestamp);
        const timeStr = formatTime(date);

        return `
            <div class="history-item" onclick="selectItem(${index})">
                <div class="item-header">
                    <div class="item-time">${timeStr}</div>
                    <div class="item-mode">
                        <span class="mode-dot"></span>
                        <span>${modeNames[item.mode] || '转写模式'}</span>
                    </div>
                </div>
                <div class="item-text">${escapeHtml(item.text)}</div>
                ${item.translation ? `
                    <div class="item-translation">
                        <strong>翻译:</strong> ${escapeHtml(item.translation)}
                    </div>
                ` : ''}
                <div class="item-actions">
                    <button class="action-btn" onclick="copyText(event, ${index})">📋 复制</button>
                    <button class="action-btn" onclick="copyTranslation(event, ${index})">📝 复制翻译</button>
                    <button class="action-btn" onclick="deleteItem(event, ${index})">🗑️ 删除</button>
                </div>
            </div>
        `;
    }).join('');
}

// Format timestamp
function formatTime(date) {
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) {
        return '刚刚';
    }

    // Less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes} 分钟前`;
    }

    // Today
    if (date.toDateString() === now.toDateString()) {
        return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }

    // This year
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // Other
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Update statistics
function updateStats() {
    const total = allHistory.length;
    const today = allHistory.filter(item => {
        const date = new Date(item.timestamp);
        const now = new Date();
        return date.toDateString() === now.toDateString();
    }).length;

    const avgLength = total > 0
        ? Math.round(allHistory.reduce((sum, item) => sum + (item.text?.length || 0), 0) / total)
        : 0;

    document.getElementById('totalCount').textContent = total;
    document.getElementById('todayCount').textContent = today;
    document.getElementById('avgLength').textContent = avgLength;
}

// Filter history
function filterHistory() {
    const searchText = document.getElementById('searchInput').value.toLowerCase();
    const modeFilter = document.getElementById('modeFilter').value;
    const timeFilter = document.getElementById('timeFilter').value;

    filteredHistory = allHistory.filter(item => {
        // Search filter
        if (searchText) {
            const text = (item.text + ' ' + (item.translation || '')).toLowerCase();
            if (!text.includes(searchText)) return false;
        }

        // Mode filter
        if (modeFilter !== 'all' && item.mode !== modeFilter) {
            return false;
        }

        // Time filter
        if (timeFilter !== 'all') {
            const date = new Date(item.timestamp);
            const now = new Date();

            switch (timeFilter) {
                case 'today':
                    if (date.toDateString() !== now.toDateString()) return false;
                    break;
                case 'week':
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    if (date < weekAgo) return false;
                    break;
                case 'month':
                    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    if (date < monthAgo) return false;
                    break;
            }
        }

        return true;
    });

    renderHistory();
}

// Select item
function selectItem(index) {
    // Could implement details view
    console.log('Selected item:', filteredHistory[index]);
}

// Copy text
async function copyText(event, index) {
    event.stopPropagation();
    const item = filteredHistory[index];
    try {
        await navigator.clipboard.writeText(item.text);
        showToast('已复制到剪贴板');
    } catch (error) {
        console.error('Failed to copy:', error);
        showToast('复制失败');
    }
}

// Copy translation
async function copyTranslation(event, index) {
    event.stopPropagation();
    const item = filteredHistory[index];
    if (!item.translation) {
        showToast('没有翻译内容');
        return;
    }
    try {
        await navigator.clipboard.writeText(item.translation);
        showToast('已复制翻译到剪贴板');
    } catch (error) {
        console.error('Failed to copy:', error);
        showToast('复制失败');
    }
}

// Delete item
async function deleteItem(event, index) {
    event.stopPropagation();
    const item = filteredHistory[index];

    if (confirm('确定要删除这条记录吗？')) {
        try {
            await ipcRenderer.invoke('delete-history-item', item.timestamp);
            allHistory = allHistory.filter(h => h.timestamp !== item.timestamp);
            filterHistory();
            updateStats();
            showToast('已删除');
        } catch (error) {
            console.error('Failed to delete:', error);
            showToast('删除失败');
        }
    }
}

// Export history
async function exportHistory() {
    try {
        const result = await ipcRenderer.invoke('export-history');
        if (result.success) {
            showToast('导出成功: ' + result.path);
        } else {
            showToast('导出失败');
        }
    } catch (error) {
        console.error('Export failed:', error);
        showToast('导出失败');
    }
}

// Clear history
async function clearHistory() {
    if (confirm('确定要清空所有历史记录吗？此操作不可恢复！')) {
        try {
            await ipcRenderer.invoke('clear-history');
            allHistory = [];
            filteredHistory = [];
            renderHistory();
            updateStats();
            showToast('已清空历史记录');
        } catch (error) {
            console.error('Failed to clear:', error);
            showToast('清空失败');
        }
    }
}

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 10000;
        animation: slideUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from {
            transform: translateX(-50%) translateY(20px);
            opacity: 0;
        }
        to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }
    @keyframes slideDown {
        from {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        to {
            transform: translateX(-50%) translateY(20px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    loadHistory();
});

// Listen for new history items
ipcRenderer.on('history-updated', () => {
    loadHistory();
});
