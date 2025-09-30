#!/usr/bin/env node

/**
 * Redis Connection Test Script
 * Tests the Redis connection with the new configuration
 */

const { createClient } = require('redis');

async function testRedisConnection() {
  console.log('🔍 Testing Redis connection...');
  
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.error('❌ Max reconnection attempts reached');
          return false;
        }
        const delay = Math.min(retries * 100, 2000);
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      },
    },
  });

  client.on('error', (err) => {
    console.error('❌ Redis Error:', err.message);
  });

  client.on('connect', () => {
    console.log('🔗 Redis: Connecting...');
  });

  client.on('ready', () => {
    console.log('✅ Redis: Connected and ready');
  });

  client.on('reconnecting', () => {
    console.log('🔄 Redis: Reconnecting...');
  });

  client.on('end', () => {
    console.log('🔌 Redis: Connection ended');
  });

  try {
    await client.connect();
    
    // Test basic operations
    await client.set('test:connection', 'success', { EX: 10 });
    const result = await client.get('test:connection');
    
    if (result === 'success') {
      console.log('✅ Redis connection test successful!');
    } else {
      console.log('❌ Redis connection test failed - unexpected result');
    }
    
    await client.del('test:connection');
    await client.disconnect();
    
  } catch (error) {
    console.error('❌ Redis connection test failed:', error.message);
    process.exit(1);
  }
}

testRedisConnection();
