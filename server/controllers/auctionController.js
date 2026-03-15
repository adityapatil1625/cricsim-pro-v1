// server/controllers/auctionController.js

const { validateRoomCode, validateBidAmount } = require("../utils/validation");
const { rooms, updateRoomActivity } = require("../utils/roomManager");

/**
 * Handle auction start
 */
function handleStartAuction(socket, io) {
  socket.on("startAuction", (data) => {
    try {
      const { code } = data;
      const room = rooms.get(code);

      if (!room || room.host !== socket.id) return;

      io.to(code).emit("startAuction");
      console.log(`🔨 Auction started in room ${code}`);
    } catch (error) {
      console.error("❌ Error in startAuction:", error);
    }
  });
}

/**
 * Handle auction bid
 */
function handleAuctionBid(socket, io) {
  socket.on("auctionBid", (data) => {
    try {
      if (socket.checkRateLimit) {
        const rate = socket.checkRateLimit('bid');
        if (!rate.allowed) {
          return;
        }
      }

      // Validate room code
      const codeValidation = validateRoomCode(data?.code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionBid:`, codeValidation.error);
        return;
      }
      
      // Validate bid amount
      const bidValidation = validateBidAmount(data?.bid);
      if (!bidValidation.valid) {
        console.error(`❌ Invalid bid amount:`, bidValidation.error);
        return;
      }
      
      const code = codeValidation.code;
      const room = rooms.get(code);

      updateRoomActivity(code);

      console.log(`📥 Received auctionBid:`, { code, playerName: data?.playerName, bid: bidValidation.bid, socketId: socket.id });

      if (!room) {
        console.log(`❌ Room ${code} not found for auctionBid`);
        return;
      }

      const isRoomMember = room.players?.some((player) => player.socketId === socket.id);
      if (!isRoomMember) {
        console.log(`⚠️  Socket ${socket.id} is not a member of room ${code}`);
        return;
      }

      // Broadcast bid to all players in the room
      const bidData = {
        playerName: data?.playerName || "Unknown",
        bid: bidValidation.bid,
        socketId: socket.id,
        teamId: data?.teamId,
        timestamp: new Date()
      };
      
      console.log(`📤 Broadcasting auctionBidUpdate to room ${code}:`, bidData);
      io.to(code).emit("auctionBidUpdate", bidData);

      console.log(`💰 Bid placed in room ${code}: ${data?.playerName} bid ₹${bidValidation.bid}L`);
    } catch (error) {
      console.error("❌ Error in auctionBid:", error);
    }
  });
}

/**
 * Handle auction queue sync
 */
function handleAuctionQueueSync(socket, io) {
  socket.on("auctionQueueSync", (data) => {
    try {
      const { code, queue } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionQueueSync:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      // Only host can sync auction queue
      if (room.host !== socket.id) {
        console.log(`⚠️  Non-host ${socket.id} tried to sync queue in ${codeValidation.code}`);
        return;
      }

      console.log(`📋 Auction queue synced in ${codeValidation.code}: ${queue?.length || 0} players`);
      io.to(codeValidation.code).emit("auctionQueueSync", { queue });
    } catch (error) {
      console.error("❌ Error in auctionQueueSync:", error);
    }
  });
}

/**
 * Handle auction player sold
 */
function handleAuctionPlayerSold(socket, io) {
  socket.on("auctionPlayerSold", (data) => {
    try {
      const { code, player, teamId, price, amount, soldPrice } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionPlayerSold:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      if (room.host !== socket.id) {
        console.log(`⚠️  Non-host ${socket.id} tried to mark player sold in ${codeValidation.code}`);
        return;
      }

      const finalPrice = price ?? amount ?? soldPrice ?? 0;
      console.log(`✅ Player sold in ${codeValidation.code}: ${player?.name} to ${teamId} for ₹${finalPrice}L`);
      // Broadcast to everyone EXCEPT the host who already processed it locally
      socket.broadcast.to(codeValidation.code).emit("auctionPlayerSold", { player, teamId, price: finalPrice });
    } catch (error) {
      console.error("❌ Error in auctionPlayerSold:", error);
    }
  });
}

/**
 * Handle auction player unsold
 */
function handleAuctionPlayerUnsold(socket, io) {
  socket.on("auctionPlayerUnsold", (data) => {
    try {
      const { code, player } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionPlayerUnsold:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      if (room.host !== socket.id) {
        console.log(`⚠️  Non-host ${socket.id} tried to mark player unsold in ${codeValidation.code}`);
        return;
      }

      console.log(`❌ Player unsold in ${codeValidation.code}: ${player?.name}`);
      // Broadcast to everyone EXCEPT the host who already processed it locally
      socket.broadcast.to(codeValidation.code).emit("auctionPlayerUnsold", { player });
    } catch (error) {
      console.error("❌ Error in auctionPlayerUnsold:", error);
    }
  });
}

/**
 * Handle auction teams update
 */
function handleAuctionTeamsUpdate(socket, io) {
  socket.on("auctionTeamsUpdate", (data) => {
    try {
      const { code, teams } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionTeamsUpdate:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      if (room.host !== socket.id) {
        console.log(`⚠️  Non-host ${socket.id} tried to update teams in ${codeValidation.code}`);
        return;
      }

      console.log(`📊 Auction teams updated in ${codeValidation.code}`);
      io.to(codeValidation.code).emit("auctionTeamsUpdateBroadcast", { teams });
    } catch (error) {
      console.error("❌ Error in auctionTeamsUpdate:", error);
    }
  });
}

/**
 * Handle auction log update
 */
function handleAuctionLogUpdate(socket, io) {
  socket.on("auctionLogUpdate", (data) => {
    try {
      const { code, logEntry } = data;
      const codeValidation = validateRoomCode(code);
      if (!codeValidation.valid) {
        console.error(`❌ Invalid room code in auctionLogUpdate:`, codeValidation.error);
        return;
      }
      const room = rooms.get(codeValidation.code);

      if (!room) return;

      if (room.host !== socket.id) {
        console.log(`⚠️  Non-host ${socket.id} tried to update log in ${codeValidation.code}`);
        return;
      }

      io.to(codeValidation.code).emit("auctionLogUpdateBroadcast", { logEntry });
    } catch (error) {
      console.error("❌ Error in auctionLogUpdate:", error);
    }
  });
}

/**
 * Initialize all auction-related socket handlers
 */
function initializeAuctionHandlers(socket, io) {
  handleStartAuction(socket, io);
  handleAuctionBid(socket, io);
  handleAuctionQueueSync(socket, io);
  handleAuctionPlayerSold(socket, io);
  handleAuctionPlayerUnsold(socket, io);
  handleAuctionTeamsUpdate(socket, io);
  handleAuctionLogUpdate(socket, io);
}

module.exports = {
  initializeAuctionHandlers,
};
