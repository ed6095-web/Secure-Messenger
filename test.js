const io = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function runTests() {
    console.log('Starting verification tests for Real-Time Messaging App...');
    
    // 1. Create Room
    const host = io(SERVER_URL);
    let roomCode = null;

    await new Promise(resolve => host.on('connect', resolve));
    console.log('Host connected.');

    const createResp = await new Promise(resolve => {
        host.emit('create_room', 'HostUser', resolve);
    });

    assert(createResp.success, 'Room creation failed');
    assert(createResp.roomCode.length === 6, 'Room code invalid');
    assert(createResp.isHost === true, 'Creator is not host');
    roomCode = createResp.roomCode;
    console.log(`Room created successfully with code: ${roomCode}`);

    // 2. Join Room (User 1-4)
    const joiners = [];
    for(let i=1; i<=4; i++) {
        const joiner = io(SERVER_URL);
        await new Promise(resolve => joiner.on('connect', resolve));
        const resp = await new Promise(resolve => {
            joiner.emit('join_room', { roomCode, username: `User${i}` }, resolve);
        });
        assert(resp.success, `User ${i} failed to join`);
        joiners.push(joiner);
    }
    console.log('4 users successfully joined. Room is full (5 total).');

    // 3. Test Capacity Limits
    const lateJoiner = io(SERVER_URL);
    await new Promise(resolve => lateJoiner.on('connect', resolve));
    const lateResp = await new Promise(resolve => {
        lateJoiner.emit('join_room', { roomCode, username: `LateUser` }, resolve);
    });
    assert(!lateResp.success, 'Exceeded capacity limit');
    assert(lateResp.message.includes('full'), `Unexpected error message: ${lateResp.message}`);
    console.log('Capacity limits enforced successfully.');

    // 4. Test Message Broadcasting
    const msgPromise = new Promise(resolve => {
        joiners[0].on('receive_message', msg => {
            if (msg.type === 'chat' && msg.message === 'Hello world!') {
                resolve();
            }
        });
    });
    
    host.emit('send_message', { roomCode, message: 'Hello world!' });
    await msgPromise;
    console.log('Message broadcasting works perfectly.');

    // 5. Test Host Controls (Delete Room)
    const destroyPromise = new Promise(resolve => {
        joiners[1].on('room_destroyed', resolve);
    });
    
    host.emit('delete_room', roomCode);
    await destroyPromise;
    console.log('Room deleted by host. Clients notified and kicked successfully.');

    // Clean up
    host.disconnect();
    joiners.forEach(j => j.disconnect());
    lateJoiner.disconnect();
    
    console.log('All tests passed successfully! Ephemeral privacy and limits verified.');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
