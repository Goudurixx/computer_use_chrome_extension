// Computer Use Agent Sidepanel
// This interface shows connection status and allows testing tasks

const taskInput = document.body.querySelector('#task-input');
const runTaskButton = document.body.querySelector('#run-task');
const connectionStatus = document.body.querySelector('#connection-status');
const logsContainer = document.body.querySelector('#logs');

// Communication is routed through the background service worker.
// The background owns the single WebSocket connection to the Python server.

function addLog(message, type = 'info') {
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logsContainer.appendChild(logEntry);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

function updateConnectionStatus(connected) {
  connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
  connectionStatus.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
}

function initBackgroundBridge() {
  // ask background for current status
  chrome.runtime.sendMessage({ type: 'ui_status' }, (res) => {
    updateConnectionStatus(res && res.connected);
  });

  // listen to background status and message events
  chrome.runtime.onMessage.addListener((event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'ws_status') {
      updateConnectionStatus(!!event.connected);
      addLog(`WS ${event.connected ? 'connected' : 'disconnected'} (${event.url || ''})`, event.connected ? 'success' : 'warning');
    }
    if (event.type === 'ws_message') {
      addLog(`Received: ${JSON.stringify(event.message)}`, 'info');
    }
    if (event.type === 'ws_error') {
      addLog(`WS Error: ${event.error}`, 'error');
    }
  });
}

function sendTask(task) {
  addLog(`Sending task: ${task}`, 'info');
  chrome.runtime.sendMessage({ type: 'ui_task', task }, (res) => {
    if (!res || !res.ok) {
      addLog(`Send failed: ${(res && res.error) || 'unknown error'}`, 'error');
    }
  });
}

// Event listeners
taskInput.addEventListener('input', () => {
  if (taskInput.value.trim()) {
    runTaskButton.removeAttribute('disabled');
  } else {
    runTaskButton.setAttribute('disabled', '');
  }
});

runTaskButton.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (task) {
    sendTask(task);
  }
});

// Initialize
addLog('Computer Use Agent initialized', 'info');
initBackgroundBridge();
