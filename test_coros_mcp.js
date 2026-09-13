#!/usr/bin/env node
/**
 * Test script for COROS MCP Server
 */

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'coros_mcp_server.js');
const dataDir = path.join(__dirname, 'data', 'coros');

console.log('Starting COROS MCP Server test...\n');

const server = spawn('node', [serverPath, dataDir], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: __dirname
});

let stdout = '';
let stderr = '';

server.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('[STDOUT]', data.toString().trim());
});

server.stderr.on('data', (data) => {
  stderr += data.toString();
  console.log('[STDERR]', data.toString().trim());
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Wait for server to start
setTimeout(() => {
  console.log('\nSending test requests...\n');
  
  // Test 1: Initialize
  const initMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {}
  });
  
  console.log('Test 1: initialize');
  console.log('Request:', initMsg);
  server.stdin.write(initMsg + '\n');
  
  // Test 2: List tools
  setTimeout(() => {
    const listMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
    
    console.log('\nTest 2: tools/list');
    console.log('Request:', listMsg);
    server.stdin.write(listMsg + '\n');
    
    // Test 3: Call tool
    setTimeout(() => {
      const toolMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_todays_runs',
          arguments: {}
        }
      });
      
      console.log('\nTest 3: tools/call (get_todays_runs)');
      console.log('Request:', toolMsg);
      server.stdin.write(toolMsg + '\n');
      
      // Wait for response and exit
      setTimeout(() => {
        console.log('\n\nClosing server...');
        server.stdin.end();
      }, 2000);
    }, 500);
  }, 500);
}, 1000);

server.on('close', (code) => {
  console.log('\nServer exited with code:', code);
  process.exit(0);
});

// Handle termination
process.on('SIGINT', () => {
  console.log('\nTerminating test...');
  server.kill();
  process.exit(0);
});
