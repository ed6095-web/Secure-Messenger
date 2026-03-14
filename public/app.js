const socket = io();

// DOM Elements
const landingView = document.getElementById('landing-view');
const chatView = document.getElementById('chat-view');

const usernameInput = document.getElementById('username-input');
const createRoomBtn = document.getElementById('create-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const maxUsersInput = document.getElementById('max-users-input');
const landingError = document.getElementById('landing-error');

const displayRoomCode = document.getElementById('display-room-code');
const userCountBadge = document.getElementById('user-count-badge');
const hostBadge = document.getElementById('host-badge');
const exitBtn = document.getElementById('exit-btn');
const deleteRoomBtn = document.getElementById('delete-room-btn');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const fileUpload = document.getElementById('file-upload');

// State
let currentRoom = null;
let currentUsername = null;
let currentMaxUsers = 5;
let isHost = false;

// Helpers
function showError(msg) {
    landingError.textContent = msg;
    setTimeout(() => {
        landingError.textContent = '';
    }, 4000);
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function getUsername() {
    const name = usernameInput.value.trim();
    if (!name) {
        showError('Please enter a username first.');
        return null;
    }
    return name;
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendMessage(msgData) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');
    
    if (msgData.type === 'system') {
        wrapper.classList.add('system');
        wrapper.innerHTML = `<div class="message-bubble">${msgData.message}</div>`;
    } else {
        const isMine = msgData.senderId === socket.id;
        wrapper.classList.add(isMine ? 'mine' : 'other');
        
        // Handle images vs text vs files
        let contentHtml = '';
        if (msgData.type === 'image') {
            contentHtml = `<img src="${msgData.data}" alt="Shared Image">`;
        } else if (msgData.type === 'file') {
            contentHtml = `<a href="${msgData.data}" download="${msgData.fileName}" class="file-link">📁 Download ${msgData.fileName}</a>`;
        } else {
            contentHtml = msgData.message;
        }

        wrapper.innerHTML = `
            <div class="message-meta">
                <span>${isMine ? 'You' : msgData.username}</span>
                <span>${formatTime(msgData.timestamp)}</span>
            </div>
            <div class="message-bubble">${contentHtml}</div>
        `;
    }

    messagesContainer.appendChild(wrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function resetChat() {
    currentRoom = null;
    isHost = false;
    messagesContainer.innerHTML = '';
    hostBadge.classList.add('hidden');
    deleteRoomBtn.classList.add('hidden');
    
    // Switch to landing
    switchView('landing-view');
}

// Event Listeners - Landing
createRoomBtn.addEventListener('click', () => {
    currentUsername = getUsername();
    if (!currentUsername) return;
    
    const maxUsers = parseInt(maxUsersInput.value, 10);

    createRoomBtn.disabled = true;
    socket.emit('create_room', { username: currentUsername, maxUsers: maxUsers }, (response) => {
        createRoomBtn.disabled = false;
        if (response.success) {
            setupChatUI(response);
        } else {
            showError(response.message || 'Error creating room');
        }
    });
});

joinRoomBtn.addEventListener('click', () => {
    currentUsername = getUsername();
    if (!currentUsername) return;

    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
        showError('Please enter a valid 6-character room code.');
        return;
    }

    joinRoomBtn.disabled = true;
    socket.emit('join_room', { roomCode: code, username: currentUsername }, (response) => {
        joinRoomBtn.disabled = false;
        if (response.success) {
            setupChatUI(response);
        } else {
            showError(response.message || 'Error joining room');
        }
    });
});

// Setup UI after successfully joining/creating
function setupChatUI(data) {
    currentRoom = data.roomCode;
    isHost = data.isHost;
    currentMaxUsers = data.maxUsers || 5;
    
    displayRoomCode.textContent = currentRoom;
    updateUserCount(data.users.length);

    if (isHost) {
        hostBadge.classList.remove('hidden');
        deleteRoomBtn.classList.remove('hidden');
    }

    switchView('chat-view');
    messagesContainer.innerHTML = '';
    appendMessage({
        type: 'system',
        message: isHost ? 'You created the room. Share the code to invite others.' : 'You joined the room.',
        timestamp: Date.now()
    });
    
    // Clear inputs in landing view
    usernameInput.value = '';
    roomCodeInput.value = '';
}

function updateUserCount(count) {
    userCountBadge.textContent = `${count}/${currentMaxUsers} Users`;
}

// Event Listeners - Chat
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = messageInput.value.trim();
    if (txt && currentRoom) {
        socket.emit('send_message', { roomCode: currentRoom, message: txt });
        messageInput.value = '';
    }
});

// File Upload Handler
fileUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;

    // 50MB limit
    if (file.size > 50 * 1024 * 1024) {
        alert("File must be smaller than 50MB");
        fileUpload.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const base64Data = evt.target.result;
        const isImage = file.type.startsWith('image/');
        
        socket.emit('send_file', {
            roomCode: currentRoom,
            fileName: file.name,
            fileData: base64Data,
            isImage: isImage
        });
    };
    reader.readAsDataURL(file);
    fileUpload.value = ''; // Reset input
});

exitBtn.addEventListener('click', () => {
    if (currentRoom) {
        socket.emit('exit_room', currentRoom);
    }
    resetChat();
});

deleteRoomBtn.addEventListener('click', () => {
    if (currentRoom && isHost) {
        if(confirm('Are you sure you want to delete this room? All messages will be permanently lost for all users.')) {
            socket.emit('delete_room', currentRoom);
        }
    }
});

// Socket Events
socket.on('receive_message', (msgData) => {
    appendMessage(msgData);
});

socket.on('room_users_update', (usersList) => {
    updateUserCount(usersList.length);
});

socket.on('room_destroyed', (reason) => {
    alert(reason);
    resetChat();
});

socket.on('disconnect', () => {
    if (currentRoom) {
        alert('Disconnected from server.');
        resetChat();
    }
});

// Best-Effort Anti-Screenshot Features
window.addEventListener('blur', () => {
    // When the window loses focus (often happens when opening snipping tool)
    document.body.classList.add('blurred');
});

window.addEventListener('focus', () => {
    document.body.classList.remove('blurred');
});

// Disable right click mapping
document.addEventListener('contextmenu', event => event.preventDefault());

// Prevent common shortcut keys (Print Screen, Save, Print)
document.addEventListener('keydown', (e) => {
    if (e.key === 'PrintScreen') {
        navigator.clipboard.writeText(''); // Attempt to clear clipboard
        document.body.classList.add('blurred');
        setTimeout(() => document.body.classList.remove('blurred'), 1000);
    }
    // Disable Ctrl+P (Print) and Ctrl+S (Save)
    if (e.ctrlKey && (e.key === 'p' || e.key === 's')) {
        e.preventDefault();
    }
});
