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
const typingIndicator = document.getElementById('typing-indicator');
const replyContext = document.getElementById('reply-context');
const replyTargetName = document.getElementById('reply-target-name');
const replyTargetText = document.getElementById('reply-target-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
const transitionScreen = document.getElementById('transition-screen');
const copyToast = document.getElementById('copy-toast');

// State
let currentRoom = null;
let currentUsername = null;
let currentMaxUsers = 5;
let isHost = false;
let currentReplyTo = null; // { username, text }
let typingTimeout = null;

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

        // Handle replies
        let replyHtml = '';
        if (msgData.replyTo) {
            replyHtml = `<div class="replied-to"><strong>${msgData.replyTo.username}</strong>: ${msgData.replyTo.text}</div>`;
        }

        wrapper.innerHTML = `
            <div class="message-meta">
                <span>${isMine ? 'You' : msgData.username}</span>
                <span>${formatTime(msgData.timestamp)}</span>
            </div>
            <div class="message-bubble" ondblclick="initReply('${msgData.username.replace(/'/g, "\\'")}', '${msgData.type === 'chat' ? contentHtml.replace(/'/g, "\\'") : 'Shared a file/image'}')">
                ${replyHtml}
                ${contentHtml}
            </div>
        `;
    }

    // Play incoming msg sound if not mine and not system
    if (msgData.type !== 'system' && msgData.senderId !== socket.id) {
        playSound('receive');
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
    switchView('transition-screen');
    
    setTimeout(() => {
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
        
        // Play join sound
        playSound('join');
    }, 1500); // Fake a secure establishing connection
}

function updateUserCount(count) {
    userCountBadge.textContent = `${count}/${currentMaxUsers} Users`;
}

// Copy to clipboard
document.getElementById('display-room-code').parentElement.addEventListener('click', () => {
    if (currentRoom) {
        navigator.clipboard.writeText(currentRoom);
        copyToast.classList.add('show');
        setTimeout(() => copyToast.classList.remove('show'), 2000);
    }
});

// Event Listeners - Chat
// Typing indicators
messageInput.addEventListener('input', () => {
    if (!currentRoom) return;
    socket.emit('typing', currentRoom);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', currentRoom);
    }, 1000);
});

// Handling Replies
function initReply(username, text) {
    currentReplyTo = { username, text };
    replyTargetName.textContent = username;
    replyTargetText.textContent = text.length > 20 ? text.substring(0, 20) + '...' : text;
    replyContext.classList.add('active');
    messageInput.focus();
}

cancelReplyBtn.addEventListener('click', () => {
    currentReplyTo = null;
    replyContext.classList.remove('active');
});

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = messageInput.value.trim();
    if (txt && currentRoom) {
        socket.emit('send_message', { 
            roomCode: currentRoom, 
            message: txt,
            replyTo: currentReplyTo
        });
        messageInput.value = '';
        socket.emit('stop_typing', currentRoom);
        playSound('send'); // Play send tick
        
        // Reset reply
        if (currentReplyTo) {
            currentReplyTo = null;
            replyContext.classList.remove('active');
        }
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

let typingActiveTimeout = null;
socket.on('user_typing', (username) => {
    typingIndicator.innerHTML = `${username} is typing... <div class="dot"></div><div class="dot"></div><div class="dot"></div>`;
    typingIndicator.classList.remove('hidden');
    typingIndicator.classList.add('active');
    
    clearTimeout(typingActiveTimeout);
    typingActiveTimeout = setTimeout(() => {
        typingIndicator.classList.remove('active');
        setTimeout(() => typingIndicator.classList.add('hidden'), 300);
    }, 2000);
});

socket.on('user_stop_typing', () => {
    typingIndicator.classList.remove('active');
    setTimeout(() => typingIndicator.classList.add('hidden'), 300);
});

socket.on('room_destroyed', (reason) => {
    document.body.classList.add('glitch-effect');
    setTimeout(() => {
        alert(reason);
        document.body.classList.remove('glitch-effect');
        resetChat();
    }, 900);
});

socket.on('disconnect', () => {
    if (currentRoom) {
        alert('Disconnected from server.');
        resetChat();
    }
});

// UI Sound Effects
function playSound(type) {
    try {
        let audioSrc;
        if (type === 'send') {
            audioSrc = 'data:audio/wav;base64,UklGRqYGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZIGAABFAEYASABHAEgASQBKAEwATgBPAFAAUwBWAE0ARwBGAD0AMgAqACkAJAAcABMABgD3/+//5v/g/9X/w/+4/6v/pP+c/5L/gf9u/2H/Uv9C/zb/J/8Z/w7/Bf/6/vT+7/7n/uD+0/7N/tP+4P71/gkALAA6AEgAWQB0AI8ApQC3ALgArgCjAIAAVQAnAAYAxP+B/07/OP8M//f+6v7j/u3+Ev84/yD/+//D/of+V/4v/uf9d/0k/eb8ffxW/En8aPx7/JX8wfzk/AL9Kv1D/UD9H/3z/M78fvw8/Av8FvxD/HH8pvz0/Df9df2g/cr91P3j/Qn+Xf7g/iL/Y/9q/zb/8f6i/mj+K/4+/nn+s/4B/z3/af+B/6P/u//N/w//Jv8+/2H/d/+O/6j/sv+///z/GQAQAOX/jv8i/6X+GP51/dr8Dfx1/N/8NP2O/cn9Fv5d/rj+K/9c/1n/RP83/y3/MP8+/zr/Cf+y/nj+Kf4G/vD97P0D/kv+vv4Z/27/lf+//yAAawCpALwAxQDpABkBRgFnAX0BeAFSAQUBtf9C/+b+lv6b/un+IP8o/+/+nf4//g7+vP1o/RD9/Pzr/OX8sfxt/Cf82Ptd+wD7l/oA+nj5gfjV99j2DfaU9eP01vMi8zTygPEg8cfwgPBq7yfuVuwE6gDotuap5Vfl0eUN50TpLOzb7vjxp/Q09vH4b/sz/Wf/nAFIA7IFaAdICZsLIg18DnQQJBLnE/gUpRZjF0cYWRlQGlkbFhwUHLMb/RopGicZmBgWGDQXehaQFVoUxRLMEQwQKA6dC/4JaAiIBr8EbAM5AvAA0//Q/sD92Pxr+676+PnT+A/42vca99f2g/YW9t71VfUT9Nrz3vLA8eTwaPAU8D/vnO7L7Vbtvuye7O/sGezZ68jrZOwN7cTtLu6B7iXu5+727sjugO6U7m/ugu4H76nvdvAS8SHyC/NI9BL1nvao9wn5k/r3+0r9A/8qAVEClwPaBBAGAwebm10QAA=';
        } else if (type === 'receive') {
            audioSrc = 'data:audio/wav;base64,UklGRp4FAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YXYFAABPAFEAUwBTAFMAUABMAEcAPwA4ADQAMQAwAC8ALQApACAAGQAVABAACAD7//P/5P/S/8b/rv+G/2r/PP8C/8T+cf4//h/+Av7r/dn9y/20/Y39dv1B/QX9pPwv/Nb7WvtO+7T7ePwc/Z390/3Y/cL9pv2A/V/9Xv2f/R/+if7H/tn+FADF/oP+Y/t1+gT68vgJ+Wj5cPl/+eP5xPou+wH71ftZ/Wf+W/18/KL74vok+vH5yvk7+g/70vuI/HD9F/1K/Lz78PqR+mX6Gvr8+Tr5/vnl+W75aPkJ+fn4/fil+af5iPnL+cH54fkZ+n763voB+2b78/sh/EL8gPwn/O/7RvwF/fH9qf3W/Sn+m/7o/hz/Xv+B/8v/IQBoAK0AyQD2ABkBkQHyARcCgAIrAu4BPQGCAOT/l/8i//n+xf6g/qP+uf6n/on+h/6W/rL+9f4v/3j/tf/L//P/IQAmABQA8P+j/1b/4P6s/of+af5g/mX+fP6D/pr+rf7W/u7++/7l/qr+OP8C//T97/2P/WD9L/0j/Q/96fy+/IX8VPwu/AD8qvuD+2v7d/uG++L7DfxO/Ij8kfx7/GX8X/xt/IL8ufwS/Uz9b/2X/a39tv3N/fT9NP5Q/mD+ZP5Q/jT+Iv4w/jv+LP4U/tz9jv1t/Vj9Ofw2/D/8Sfxn/Jf80vwf/UX9gv2u/cP9wf2h/XP9Lf0E/cb8kfxQ/Dj8Avy/+3/7Mvvy+sf6a/o8+r/5MvnX+M74Ufjs9xz3Tvak9SP1ePQT9ATziPIA8rPxPPH+8O3wifB18CfwVvD38Mnxp/Id8zrz7vMC9D30B/S+88DznvOR8u/xmPE+8ajwt+9Y72fuYe1F7FPrjepZ6R3o9uZa5gLmJeaQ5ifntOel6JjphuqC64nsDu0T7gPvde4J4s8fHk1';
        } else if (type === 'join') {
            audioSrc = 'data:audio/wav;base64,UklGRi4GAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQYGAACWAJEAhgCAAHcAagBSADUAHAD7/+3/zf+v/4L/Pf8U/9b+qv6D/mz+Y/5c/lL+VP5k/mT+Tf4//kL+RP5b/oz+uv7R/uP+2v7P/rH+e/5J/hn+4v2//cP9w/36/TT+lf6S/oT+eP5W/jj+Qv5G/jP+Iv4u/lr+oP7P/rD+ff6E/oH+c/5o/nr+uP79/h//Hf8o/zv/LP8N//z+1v6l/pb+df1E/Bf7gPnl9+L1d/M48sPxd/B47zjuwezb6iTpJufA5g7m++WQ5QDlkOUA5QXldOXD5T7mw+Yo5yzoculL6q/rueyw7TLuWe/u7wnxEPH08UjyqPLQ8hnyAvLu8TjxY/Di7xHvr+6l7oTuAu8r78ruj+3f65/qLOks6LvmneX/5MvkFOWL5d3lJubx5c3lKuaq5g/nheee5y3noObm5jHnfuiJ6aLpvOoY7FTsvux+7ezthe5z75vv7u/u8PTwhe+F7ofua+4X7tDsu+uc6rPpu+k/6XfonOdi59Lm1OVv5cjkReSm5E/lceUg5X3kF+Rz4ybi/uDw32Pe4tzk2+bZ3dkm21vb9ttM3P3bzNut3B/dbt4h3xPgceE94p/if+J/4sLhw+D23wPfe9583YjcKdv32q7aWNpi2nDaVdqn2ZTY5ddm1kLVGtR106PSE9If0tLRwNHc0SnSA9IO0rDRj9HP0e7RU9Jq0ibTWNQK1SPW99b111PYfNk52tjaHNtK2h3ZztiW2O3XEdfK2DfYhNhP2BrYsNcO11/WDNbj1T3UjdN70t/RT9F70KPPK85jzUvMIMwqywPLeMtWyyLLAMuUy8PLtMs6yzXLcsuqyxXL3crfytrKBcvEy7TLJMsjy9TLTcx8y8bKZMqsyi3KscmVyaXIRcimySjKgco8yi/Kncn6yMbIesjbx0HH9caMxhvGRcY7xnTGFcY6xiHFp8VjxaLFPsYfxgfFvcTjxK7EVcRlxGvEu8RbxXnF0MUMxkbGl8Z9xpHGxcaCxiXGHcZkxvLFd8VQxabFTMUZxavEXsQaxDrERMRXxHfEiMT2w/nDjMP1wpPD8sM2xMjEqMPQw1jDf8Now5TDrcOzw/XDKcTVwy3DwMIsws/BZMFvwaTBrcGvwbXBycG7wZ7BKcECwZbBYcG/wSzBfMHRwbHBhcFXwc7ALcDewPbAZMEOwgXCAMLgwRLCTcLwwtnCB8Mmw0TDRMNaw2fDosOzwxvEOcRHxFTFacWoxazFwMWQxRtFRUUqRQRFPkULRanEqsRLxL3DT8MRwymDRMNkxIHE9sTqxOfEecR5xIPEjMSSxI3EfMQ+xFPEZcRTxIfEhMTkxAbFGMUXxfLEysTKxFHFOEUwRUlFdEWjxd7FFMbQxYbGGcYaxhzGGcYZxkfGNcbqxZfFusXRxeTFH8XoxebF5MUXxRbFFAUWRdLF5sXsxSrFBsU+RebFLcVHxUTFpMW3xSfFFkUYRRhFAEUmRTbFS8VVxRnFEMXUxZfFv8XjxdDFwMWoxWzFpMWqxavFqMUoxR7FH8XLxdfFj8WAxbHFrwUrRUhFO0VIxW/FTMWOxabF4oUXRSlFBEUiRQpF';
        }

        if (audioSrc) {
            const audio = new Audio(audioSrc);
            audio.volume = 0.5;
            audio.play().catch(e => console.log('Audio auto-play prevented.'));
        }
    } catch(e) {}
}

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
