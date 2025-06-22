// utils/emitToUser.js
const emitToUser = (userId, event, payload) => {
    try {
        if (!global.io) throw new Error('Socket.IO not initialized');
        if (!userId) throw new Error('User ID required');

        global.io.to(userId.toString()).emit(event, payload);
        return true;
    } catch (error) {
        console.error(`Emit failed [${event}]:`, error);
        return false;
    }
};

export default { emitToUser };