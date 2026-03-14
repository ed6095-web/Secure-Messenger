const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Increase maxHttpBufferSize to 50MB to handle file/image Base64 uploads safely
const io = new Server(server, {
    maxHttpBufferSize: 50e6
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory room state
const rooms = {};

// Helper to generate a 6 character alphanumeric code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

io.on('connection', (socket) => {
    // When a user creates a room
    socket.on('create_room', (data, callback) => {
        const username = typeof data === 'string' ? data : data.username;
        const maxUsers = data.maxUsers ? parseInt(data.maxUsers, 10) : 5;

        let roomCode = generateRoomCode();
        while (rooms[roomCode]) {
            roomCode = generateRoomCode();
        }

        const room = {
            id: roomCode,
            host: socket.id,
            maxUsers: maxUsers,
            users: new Map(), // socket.id -> { username, joinedAt, ip }
            timeout: null
        };

        const userObj = {
            username: username,
            joinedAt: Date.now(),
            ip: socket.handshake.address // Simple IP logging
        };

        room.users.set(socket.id, userObj);
        rooms[roomCode] = room;

        socket.join(roomCode);
        
        // Setup inactivity timeout
        resetRoomTimeout(roomCode);

        // Acknowledge creation with room details
        callback({
            success: true,
            roomCode: roomCode,
            isHost: true,
            maxUsers: room.maxUsers,
            users: Array.from(room.users.values()).map(u => u.username)
        });
        
        // Broadcast user list update
        io.to(roomCode).emit('room_users_update', Array.from(room.users.values()).map(u => u.username));
    });

    // When a user joins a room
    socket.on('join_room', ({ roomCode, username }, callback) => {
        const room = rooms[roomCode];
        if (!room) {
            return callback({ success: false, message: 'Invalid room code.' });
        }

        if (room.users.size >= room.maxUsers) {
            return callback({ success: false, message: `Room is full (max ${room.maxUsers} users).` });
        }

        const userObj = {
            username: username,
            joinedAt: Date.now(),
            ip: socket.handshake.address
        };

        room.users.set(socket.id, userObj);
        socket.join(roomCode);

        // Reset inactivity
        resetRoomTimeout(roomCode);

        callback({
            success: true,
            roomCode: roomCode,
            isHost: false,
            maxUsers: room.maxUsers,
            users: Array.from(room.users.values()).map(u => u.username)
        });

        // Broadcast user joined
        io.to(roomCode).emit('room_users_update', Array.from(room.users.values()).map(u => u.username));
        io.to(roomCode).emit('receive_message', {
            type: 'system',
            message: `${username} joined the room.`,
            timestamp: Date.now()
        });
    });

    // When a message is sent
    socket.on('send_message', ({ roomCode, message, replyTo }) => {
        const room = rooms[roomCode];
        if (room && room.users.has(socket.id)) {
            const username = room.users.get(socket.id).username;
            
            io.to(roomCode).emit('receive_message', {
                type: 'chat',
                username: username,
                message: message,
                replyTo: replyTo,
                timestamp: Date.now(),
                senderId: socket.id
            });

            resetRoomTimeout(roomCode);
        }
    });

    // Typing Indicators
    socket.on('typing', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.users.has(socket.id)) {
            const username = room.users.get(socket.id).username;
            socket.to(roomCode).emit('user_typing', username);
        }
    });

    socket.on('stop_typing', (roomCode) => {
        socket.to(roomCode).emit('user_stop_typing');
    });

    // When a file is sent
    socket.on('send_file', ({ roomCode, fileName, fileData, isImage }) => {
        const room = rooms[roomCode];
        if (room && room.users.has(socket.id)) {
            const username = room.users.get(socket.id).username;
            
            io.to(roomCode).emit('receive_message', {
                type: isImage ? 'image' : 'file',
                username: username,
                data: fileData,
                fileName: fileName,
                timestamp: Date.now(),
                senderId: socket.id
            });

            resetRoomTimeout(roomCode);
        }
    });

    // When host explicitly deletes room
    socket.on('delete_room', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            destroyRoom(roomCode, 'Room deleted by host.');
        }
    });

    // When a participant explicitly exits (or host exits)
    socket.on('exit_room', (roomCode) => {
        handleUserLeft(socket.id, roomCode);
    });

    // On disconnect
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].users.has(socket.id)) {
                handleUserLeft(socket.id, roomCode);
            }
        }
    });

    function handleUserLeft(socketId, roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.host === socketId) {
            // Host leaves -> destroy room
            destroyRoom(roomCode, 'Host exited. Room closed.');
        } else {
            // Normal user leaves
            const user = room.users.get(socketId);
            if (user) {
                room.users.delete(socketId);
                const socketToLeave = io.sockets.sockets.get(socketId);
                if (socketToLeave) socketToLeave.leave(roomCode);
                
                io.to(roomCode).emit('room_users_update', Array.from(room.users.values()).map(u => u.username));
                io.to(roomCode).emit('receive_message', {
                    type: 'system',
                    message: `${user.username} left the room.`,
                    timestamp: Date.now()
                });
            }
        }
    }

    function destroyRoom(roomCode, reason) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timeout) clearTimeout(room.timeout);

        io.to(roomCode).emit('room_destroyed', reason);
        
        // Evict all sockets from this room dynamically
        io.in(roomCode).fetchSockets().then(sockets => {
            for (const s of sockets) {
                s.leave(roomCode);
            }
        });

        // Erase room from memory
        delete rooms[roomCode];
    }

    function resetRoomTimeout(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.timeout) {
            clearTimeout(room.timeout);
        }

        room.timeout = setTimeout(() => {
            destroyRoom(roomCode, 'Room destroyed due to 30 minutes of inactivity.');
        }, INACTIVITY_TIMEOUT);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
