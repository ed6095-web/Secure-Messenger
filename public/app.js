const socket = io();

// DOM Elements
const landingView = document.getElementById('landing-view');
const chatView = document.getElementById('chat-view');

const usernameInput = document.getElementById('username-input');
const createRoomBtn = document.getElementById('create-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const landingError = document.getElementById('landing-error');

const displayRoomCode = document.getElementById('display-room-code');
const userCountBadge = document.getElementById('user-count-badge');
const hostBadge = document.getElementById('host-badge');
const exitBtn = document.getElementById('exit-btn');
const deleteRoomBtn = document.getElementById('delete-room-btn');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// State
let currentRoom = null;
let currentUsername = null;
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
        
        wrapper.innerHTML = `
            <div class="message-meta">
                <span>${isMine ? 'You' : msgData.username}</span>
                <span>${formatTime(msgData.timestamp)}</span>
            </div>
            <div class="message-bubble">${msgData.message}</div>
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

    createRoomBtn.disabled = true;
    socket.emit('create_room', currentUsername, (response) => {
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
    userCountBadge.textContent = `${count}/5 Users`;
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
