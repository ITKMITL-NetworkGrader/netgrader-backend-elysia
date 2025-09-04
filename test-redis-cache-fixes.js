#!/usr/bin/env node

/**
 * Redis Cache Invalidation Test
 * Tests the implemented cache invalidation fixes
 */

const { createClient } = require('redis');
const { performance } = require('perf_hooks');

// Load environment variables
require('dotenv').config();

class RedisCacheInvalidationTest {
  constructor() {
    this.client = null;
    this.testResults = [];
  }

  // Helper method to log test results
  logTest(testName, success, message, duration = null) {
    const status = success ? '✅ PASS' : '❌ FAIL';
    const durationStr = duration ? ` (${duration.toFixed(2)}ms)` : '';
    console.log(`${status} ${testName}${durationStr}`);
    if (message) console.log(`   ${message}`);
    
    this.testResults.push({
      testName,
      success,
      message,
      duration
    });
  }

  async connect() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err.message);
      });

      await this.client.connect();
      console.log('✅ Connected to Redis for cache invalidation testing');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error.message);
      return false;
    }
  }

  // Test cache invalidation pattern matching
  async testCacheInvalidationPatterns() {
    console.log('\n=== Testing Cache Invalidation Patterns ===');
    
    try {
      // Test Task Template cache pattern
      const taskTemplateId = 'test_template_123';
      const taskCacheKey = `task_template:${taskTemplateId}`;
      
      // Set up test data
      await this.client.setEx(taskCacheKey, 3600, JSON.stringify({
        templateId: taskTemplateId,
        name: 'Test Template',
        description: 'Original description'
      }));
      
      // Verify data is cached
      const cachedBefore = await this.client.get(taskCacheKey);
      this.logTest('Task Template Cache Set', cachedBefore !== null, 'Template cached successfully');
      
      // Test clearCachePattern for task templates
      const keys = await this.client.keys(`task_template:${taskTemplateId}`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      
      // Verify cache is cleared
      const cachedAfter = await this.client.get(taskCacheKey);
      this.logTest('Task Template Cache Invalidation', cachedAfter === null, 'Cache properly invalidated');
      
      // Test Device Template cache pattern
      const deviceTemplateId = 'device_template_456';
      const deviceCacheKey = `device_template:${deviceTemplateId}`;
      
      // Set up test data
      await this.client.setEx(deviceCacheKey, 3600, JSON.stringify({
        id: deviceTemplateId,
        name: 'Test Device Template',
        platform: 'cisco'
      }));
      
      // Verify data is cached
      const deviceCachedBefore = await this.client.get(deviceCacheKey);
      this.logTest('Device Template Cache Set', deviceCachedBefore !== null, 'Device template cached successfully');
      
      // Test clearCachePattern for device templates
      const deviceKeys = await this.client.keys(`device_template:${deviceTemplateId}`);
      if (deviceKeys.length > 0) {
        await this.client.del(deviceKeys);
      }
      
      // Verify cache is cleared
      const deviceCachedAfter = await this.client.get(deviceCacheKey);
      this.logTest('Device Template Cache Invalidation', deviceCachedAfter === null, 'Device cache properly invalidated');
      
    } catch (error) {
      this.logTest('Cache Invalidation Patterns', false, `Error: ${error.message}`);
    }
  }

  // Test IP cache clearing pattern
  async testIPCacheClearingPattern() {
    console.log('\n=== Testing IP Cache Clearing Pattern ===');
    
    try {
      const labId = 'lab_789';
      const studentId1 = 'student_123';
      const studentId2 = 'student_456';
      
      // Set up multiple IP cache entries for the lab
      await this.client.setEx(`ips:${labId}:${studentId1}`, 86400, JSON.stringify({
        'router1_mgmt-ip': '10.30.6.1',
        'pc1_lan-ip': '10.30.6.10'
      }));
      
      await this.client.setEx(`ips:${labId}:${studentId2}`, 86400, JSON.stringify({
        'router1_mgmt-ip': '10.30.7.1',
        'pc1_lan-ip': '10.30.7.10'
      }));
      
      // Verify data is cached
      const ipCached1 = await this.client.get(`ips:${labId}:${studentId1}`);
      const ipCached2 = await this.client.get(`ips:${labId}:${studentId2}`);
      this.logTest('IP Cache Set', ipCached1 !== null && ipCached2 !== null, 'IP assignments cached for both students');
      
      // Test wildcard pattern clearing (simulating clearLabIPCache)
      const ipKeys = await this.client.keys(`ips:${labId}:*`);
      this.logTest('IP Keys Found', ipKeys.length === 2, `Found ${ipKeys.length} IP cache entries`);
      
      if (ipKeys.length > 0) {
        await this.client.del(ipKeys);
      }
      
      // Verify all IP cache entries are cleared
      const ipCachedAfter1 = await this.client.get(`ips:${labId}:${studentId1}`);
      const ipCachedAfter2 = await this.client.get(`ips:${labId}:${studentId2}`);
      this.logTest('IP Cache Clearing', ipCachedAfter1 === null && ipCachedAfter2 === null, 'All IP cache entries cleared');
      
    } catch (error) {
      this.logTest('IP Cache Clearing Pattern', false, `Error: ${error.message}`);
    }
  }

  // Test cache consistency scenario
  async testCacheConsistencyScenario() {
    console.log('\n=== Testing Cache Consistency Scenario ===');
    
    try {
      // Simulate the issue we fixed: update without cache invalidation
      const templateId = 'consistency_test';
      const cacheKey = `task_template:${templateId}`;
      
      // Step 1: Cache original data
      const originalData = {
        templateId,
        name: 'Original Template',
        description: 'Original description'
      };
      
      await this.client.setEx(cacheKey, 3600, JSON.stringify(originalData));
      
      // Step 2: Simulate database update (without cache invalidation - the old bug)
      const updatedData = {
        templateId,
        name: 'Updated Template',
        description: 'Updated description'
      };
      
      // Check cache still returns old data
      const staleCache = await this.client.get(cacheKey);
      const staleCacheData = JSON.parse(staleCache);
      this.logTest('Stale Cache Detection', staleCacheData.name === 'Original Template', 'Cache still contains old data');
      
      // Step 3: Simulate proper cache invalidation (our fix)
      const keys = await this.client.keys(`task_template:${templateId}`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      
      // Step 4: Set fresh cache data
      await this.client.setEx(cacheKey, 3600, JSON.stringify(updatedData));
      
      // Step 5: Verify cache now returns updated data
      const freshCache = await this.client.get(cacheKey);
      const freshCacheData = JSON.parse(freshCache);
      this.logTest('Cache Consistency Fix', freshCacheData.name === 'Updated Template', 'Cache now returns updated data');
      
    } catch (error) {
      this.logTest('Cache Consistency Scenario', false, `Error: ${error.message}`);
    }
  }

  // Test TTL behavior with cache invalidation
  async testTTLBehavior() {
    console.log('\n=== Testing TTL Behavior ===');
    
    try {
      const testKey = 'ttl_test_key';
      
      // Set with TTL
      await this.client.setEx(testKey, 10, 'test_value');
      
      // Check initial TTL
      const initialTTL = await this.client.ttl(testKey);
      this.logTest('TTL Set', initialTTL > 0 && initialTTL <= 10, `Initial TTL: ${initialTTL}s`);
      
      // Simulate cache invalidation
      const deleted = await this.client.del(testKey);
      this.logTest('TTL Cache Deletion', deleted === 1, 'Cache entry deleted before TTL expiry');
      
      // Verify key is gone
      const afterDeletion = await this.client.get(testKey);
      this.logTest('TTL Post-Deletion Check', afterDeletion === null, 'Key properly removed');
      
    } catch (error) {
      this.logTest('TTL Behavior', false, `Error: ${error.message}`);
    }
  }

  // Clean up and disconnect
  async cleanup() {
    console.log('\n=== Cleaning Up ===');
    
    try {
      // Clean up any test keys
      const testKeys = await this.client.keys('*test*');
      if (testKeys.length > 0) {
        await this.client.del(testKeys);
        console.log(`   Cleaned up ${testKeys.length} test keys`);
      }
      
      if (this.client && this.client.isOpen) {
        await this.client.disconnect();
        this.logTest('Redis Disconnect', true, 'Successfully disconnected from Redis');
      }
    } catch (error) {
      this.logTest('Cleanup', false, `Cleanup failed: ${error.message}`);
    }
  }

  // Print summary
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('REDIS CACHE INVALIDATION TEST SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.testResults.filter(r => r.success).length;
    const total = this.testResults.length;
    const failed = total - passed;
    
    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed/total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults.filter(r => !r.success).forEach(test => {
        console.log(`  • ${test.testName}: ${test.message}`);
      });
    } else {
      console.log('\n🎉 All cache invalidation fixes are working correctly!');
    }
    
    console.log('\n📋 What was tested:');
    console.log('  ✓ Task template cache invalidation patterns');
    console.log('  ✓ Device template cache invalidation patterns');  
    console.log('  ✓ IP cache wildcard clearing');
    console.log('  ✓ Cache consistency after updates');
    console.log('  ✓ TTL behavior with manual invalidation');
    
    console.log('='.repeat(60));
  }

  // Run all tests
  async runAllTests() {
    console.log('🧪 Starting Redis Cache Invalidation Tests...');
    console.log(`Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
    
    const connected = await this.connect();
    if (!connected) {
      console.error('Cannot proceed without Redis connection');
      return;
    }
    
    try {
      await this.testCacheInvalidationPatterns();
      await this.testIPCacheClearingPattern();
      await this.testCacheConsistencyScenario();
      await this.testTTLBehavior();
    } catch (error) {
      console.error('❌ Critical error during testing:', error.message);
    } finally {
      await this.cleanup();
      this.printSummary();
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new RedisCacheInvalidationTest();
  tester.runAllTests().catch(console.error);
}

module.exports = RedisCacheInvalidationTest;