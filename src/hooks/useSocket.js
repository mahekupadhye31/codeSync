'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket(documentId) {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    // Don't connect if no documentId yet
    if (!documentId) {
      console.log('⏳ Waiting for document ID...');
      return;
    }

    console.log('🔌 Connecting to WebSocket for document:', documentId);

    // Create socket connection
    socketRef.current = io('http://localhost:5000');

    socketRef.current.on('connect', () => {
      console.log('✅ Connected to WebSocket');
      setIsConnected(true);

      // Join document room
      const username = `User-${Math.floor(Math.random() * 1000)}`;
      const color = `#${Math.floor(Math.random()*16777215).toString(16)}`;
      
      console.log('📍 Joining document room:', documentId);
      socketRef.current.emit('join-document', {
        documentId,
        username,
        color
      });
    });

    socketRef.current.on('disconnect', () => {
      console.log('❌ Disconnected from WebSocket');
      setIsConnected(false);
    });

    // Handle users update
    socketRef.current.on('users-update', (updatedUsers) => {
      console.log('👥 Users updated:', updatedUsers);
      setUsers(updatedUsers);
    });

    socketRef.current.on('user-joined', (user) => {
      console.log('👤 User joined:', user.username);
      setUsers(prev => [...prev, user]);
    });

    socketRef.current.on('user-left', ({ id, username }) => {
      console.log('👋 User left:', username);
      setUsers(prev => prev.filter(user => user.id !== id));
    });

    // Cleanup
    return () => {
      if (socketRef.current) {
        console.log('🔌 Disconnecting socket');
        socketRef.current.disconnect();
      }
    };
  }, [documentId]); // Only reconnect when documentId changes

  return {
    socket: socketRef.current,
    isConnected,
    users
  };
}