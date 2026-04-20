export const roomStore = new Map();

export const getRoom = (roomCode) => roomStore.get(roomCode);

export const saveRoom = (room) => {
  roomStore.set(room.roomCode, room);
  return room;
};

export const deleteRoom = (roomCode) => {
  roomStore.delete(roomCode);
};

export const listRooms = () => Array.from(roomStore.values());
