#!/usr/bin/env node
/**
 * Interactive test for COROS MCP Server
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const serverPath = path.join(__dirname, 'coros_mcp_server.js');
const dataDir = path.join(__dirname, 'data', 'coros');

console.log('🚀 COROS MCP Server - Interactive Test\n');

const server = spawn('node', [serverPath, dataDir], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let responseBuffer = [];
let isWaitingForResponse = false;

server.stdout.on('data', (data) => {
  const text = data.toString().trim();
  if (text) {
    console.log('\n📨 Response from server:');
    try {
      const response = JSON.parse(text);
      console.log(JSON.stringify(response, null, 2));
    } catch (e) {
      console.log(text);
    }
    isWaitingForResponse = false;
  }
});

server.stderr.on('data', (data) => {
  const text = data.toString().trim();
  if (text) {
    console.log('[SERVER LOG]', text);
  }
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  rl.close();
  process.exit(1);
});

console.log('📝 Available commands:\n');
console.log('  1. get_todays_runs [date]  - Get runs for a date (default: today)');
console.log('  2. get_run_summary <date> <labelId>  - Get run summary');
console.log('  3. get_intraday <date> <labelId>  - Get intraday data\n');
console.log('Examples:');
console.log('  > 1');
console.log('  > 1 2026-07-28');
console.log('  > 2 2026-07-28 479218228170621029');
console.log('  > 3 2026-07-28 479218228170621029\n');

function prompt() {
  rl.question('> ', (input) => {
    const args = input.trim().split(/\s+/);
    const cmd = args[0];

    if (!cmd) {
      prompt();
      return;
    }

    let message;

    if (cmd === '1') {
      const date = args[1] || (() => {
        const d = new Date();
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
      })();
      
      message = {
        jsonrpc: '2.0',
        id: Math.random(),
        method: 'tools/call',
        params: { name: 'get_todays_runs', arguments: { date } }
      };
      console.log(`📤 Getting runs for ${date}...`);
    } else if (cmd === '2') {
      if (!args[1] || !args[2]) {
        console.log('❌ Usage: 2 <date> <labelId>');
        prompt();
        return;
      }
      
      message = {
        jsonrpc: '2.0',
        id: Math.random(),
        method: 'tools/call',
        params: { name: 'get_run_summary', arguments: { date: args[1], labelId: args[2] } }
      };
      console.log(`📤 Getting summary for ${args[1]} / ${args[2]}...`);
    } else if (cmd === '3') {
      if (!args[1] || !args[2]) {
        console.log('❌ Usage: 3 <date> <labelId>');
        prompt();
        return;
      }
      
      message = {
        jsonrpc: '2.0',
        id: Math.random(),
        method: 'tools/call',
        params: { name: 'get_run_intraday_data', arguments: { date: args[1], labelId: args[2] } }
      };
      console.log(`📤 Getting intraday data for ${args[1]} / ${args[2]}...`);
    } else if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      console.log('Bye!');
      server.stdin.end();
      rl.close();
      process.exit(0);
    } else {
      console.log('❌ Unknown command');
      prompt();
      return;
    }

    if (message) {
      server.stdin.write(JSON.stringify(message) + '\n');
      isWaitingForResponse = true;
      
      setTimeout(() => {
        if (isWaitingForResponse) {
          console.log('⏱️  Timeout waiting for response');
        }
        prompt();
      }, 3000);
    }
  });
}

setTimeout(() => {
  prompt();
}, 500);
