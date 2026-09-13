#!/usr/bin/env node
/**
 * COROS MCP Server
 * Provides access to local COROS FIT data via MCP protocol (stdio transport)
 * Used by CODEX Windows app to fetch running data without depending on OpenAI
 */

const fs = require('fs').promises;
const path = require('path');

// Parse arguments for configuration
const args = process.argv.slice(2);
const COROS_DATA_DIR = args[0] || path.join(__dirname, 'data', 'coros');

// MCP protocol utilities
let requestId = 0;

function generateRequestId() {
  return ++requestId;
}

function sendResponse(result, id = null) {
  const response = {
    jsonrpc: '2.0',
    result,
    ...(id !== null && { id })
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(error, id = null) {
  const response = {
    jsonrpc: '2.0',
    error: {
      code: error.code || -32603,
      message: error.message || 'Internal error'
    },
    ...(id !== null && { id })
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendNotification(method, params) {
  const notification = {
    jsonrpc: '2.0',
    method,
    params
  };
  process.stdout.write(JSON.stringify(notification) + '\n');
}

// COROS data access functions
async function readMetadata(date, labelId) {
  try {
    const metadataDir = path.join(COROS_DATA_DIR, 'metadata');
    const filename = `${date}_${labelId}.json`;
    const filepath = path.join(metadataDir, filename);
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readIntraday(date, labelId) {
  try {
    const intradayDir = path.join(COROS_DATA_DIR, 'intraday');
    const filename = `${date}_${labelId}.json`;
    const filepath = path.join(intradayDir, filename);
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function listRunsByDate(targetDate) {
  try {
    const metadataDir = path.join(COROS_DATA_DIR, 'metadata');
    const files = await fs.readdir(metadataDir);
    
    const runFiles = files.filter(f => f.startsWith(targetDate) && f.endsWith('.json'));
    
    const runs = [];
    for (const file of runFiles) {
      try {
        const data = await fs.readFile(path.join(metadataDir, file), 'utf8');
        const metadata = JSON.parse(data);
        runs.push({
          labelId: metadata.labelId,
          date: metadata.date,
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          activityDetails: metadata.activityDetails || {}
        });
      } catch (e) {
        // Skip invalid files
      }
    }
    
    return runs.sort((a, b) => {
      const timeA = String(a.startTime || '');
      const timeB = String(b.startTime || '');
      return timeB.localeCompare(timeA);
    });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function formatTodaysSummary(date) {
  const runs = await listRunsByDate(date);
  if (runs.length === 0) {
    return `# ${date} のラン\n\n記録なし\n`;
  }

  let markdown = `# ${date} のラン\n\n`;
  
  for (const run of runs) {
    const details = run.activityDetails || {};
    const distance = Number(details.distanceKm || 0).toFixed(2);
    const duration = Number(details.durationSeconds || 0);
    const durationMin = Math.floor(duration / 60);
    const pace = details.averagePace || '-';
    const avgHR = Math.round(Number(details.averageHeartRate || 0));
    const calories = Number(details.calories || 0);
    
    markdown += `## ラン ID: ${run.labelId}\n`;
    markdown += `- **日付**: ${run.date}\n`;
    markdown += `- **開始時刻**: ${run.startTime || '不明'}\n`;
    markdown += `- **距離**: ${distance} km\n`;
    markdown += `- **時間**: ${durationMin} 分\n`;
    markdown += `- **平均ペース**: ${pace}\n`;
    markdown += `- **平均心拍**: ${avgHR} bpm\n`;
    markdown += `- **カロリー**: ${calories.toFixed(0)} kcal\n\n`;
  }

  return markdown;
}

// MCP Tool Definitions
const tools = [
  {
    name: 'get_todays_runs',
    description: 'Get a list of all running activities for today',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (default: today)'
        }
      },
      required: []
    }
  },
  {
    name: 'get_run_summary',
    description: 'Get detailed summary of a specific run including distance, pace, heart rate, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Run date in YYYY-MM-DD format'
        },
        labelId: {
          type: 'string',
          description: 'COROS run label ID'
        }
      },
      required: ['date', 'labelId']
    }
  },
  {
    name: 'get_run_intraday_data',
    description: 'Get minute-by-minute intraday data for a run (speed, HR, altitude, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Run date in YYYY-MM-DD format'
        },
        labelId: {
          type: 'string',
          description: 'COROS run label ID'
        }
      },
      required: ['date', 'labelId']
    }
  }
];

// MCP Tool Handlers
async function handleGetTodaysRuns(input) {
  const today = new Date();
  const date = input.date || [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');

  const runs = await listRunsByDate(date);
  const summary = await formatTodaysSummary(date);

  return {
    date,
    runCount: runs.length,
    runs: runs.map(r => ({
      labelId: r.labelId,
      date: r.date,
      startTime: r.startTime,
      distance: Number(r.activityDetails?.distanceKm || 0).toFixed(2),
      durationSeconds: Number(r.activityDetails?.durationSeconds || 0),
      averageHeartRate: Math.round(Number(r.activityDetails?.averageHeartRate || 0))
    })),
    summary
  };
}

async function handleGetRunSummary(input) {
  const { date, labelId } = input;
  
  if (!date || !labelId) {
    throw new Error('date and labelId are required');
  }

  const metadata = await readMetadata(date, labelId);
  if (!metadata) {
    return {
      error: 'Run not found',
      date,
      labelId
    };
  }

  // Handle both 'activityDetails' and 'activityDetail' field names
  const details = metadata.activityDetails || metadata.activityDetail || {};
  return {
    labelId: metadata.labelId,
    date: metadata.date,
    startTime: metadata.startTime,
    endTime: metadata.endTime,
    distance: Number(details.distanceKm || 0).toFixed(2),
    durationSeconds: Number(details.workoutTime || 0),
    averagePace: details.averagePace || details.adjustedPace || null,
    averageHeartRate: Math.round(Number(details.averageHeartRateBpm || 0)),
    averageCadence: Math.round(Number(details.averageCadenceSpm || 0)),
    averageStride: Number(details.averageStrideLengthM || 0).toFixed(2),
    calories: Number(details.caloriesKcal || 0).toFixed(0),
    sportType: metadata.sportType,
    location: details.location || null,
    trainingLoad: Number(details.trainingLoad || 0),
    elevationGain: Number(details.elevationGainM || 0),
    elevationLoss: Number(details.elevationLossM || 0),
    bestKilometer: details.bestKilometer || null,
    performance: details.performance || null,
    metadata
  };
}

async function handleGetRunIntradayData(input) {
  const { date, labelId } = input;
  
  if (!date || !labelId) {
    throw new Error('date and labelId are required');
  }

  const intraday = await readIntraday(date, labelId);
  if (!intraday) {
    return {
      error: 'Intraday data not found',
      date,
      labelId
    };
  }

  const chartData = intraday.chartData || [];
  return {
    labelId,
    date,
    dataPointCount: chartData.length,
    chartData: chartData.slice(0, 120) // Return first 120 minutes to avoid huge responses
  };
}

// Initialize connection
console.error('[COROS MCP] Server starting on stdio transport');
console.error(`[COROS MCP] Data directory: ${COROS_DATA_DIR}`);

// Input handling
let inputBuffer = '';

// Handle stdin EOF gracefully
if (process.stdin.isTTY) {
  console.error('[COROS MCP] Warning: stdin is a TTY, server may not work as expected');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  inputBuffer += chunk;
  
  const lines = inputBuffer.split('\n');
  inputBuffer = lines.pop(); // Keep the incomplete line
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const message = JSON.parse(line);
      
      // Handle initialize request
      if (message.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: {
              name: 'coros-mcp-server',
              version: '1.0.0'
            }
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
        continue;
      }
      
      // Handle initialized notification
      if (message.method === 'notifications/initialized') {
        console.error('[COROS MCP] Client initialized');
        continue;
      }
      
      // Handle tool listing
      if (message.method === 'tools/list') {
        sendResponse({ tools }, message.id);
        continue;
      }
      
      // Handle tool calls
      if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        
        try {
          let result;
          
          if (name === 'get_todays_runs') {
            result = await handleGetTodaysRuns(args || {});
          } else if (name === 'get_run_summary') {
            result = await handleGetRunSummary(args || {});
          } else if (name === 'get_run_intraday_data') {
            result = await handleGetRunIntradayData(args || {});
          } else {
            throw new Error(`Unknown tool: ${name}`);
          }
          
          sendResponse({
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }, message.id);
        } catch (err) {
          sendError({
            code: -32603,
            message: err.message || 'Tool execution failed'
          }, message.id);
        }
        continue;
      }
      
      // Unknown method
      sendError({
        code: -32601,
        message: `Method not found: ${message.method}`
      }, message.id);
      
    } catch (err) {
      console.error('[COROS MCP] Parse error:', err.message);
      sendError({
        code: -32700,
        message: 'Parse error'
      });
    }
  }
});

process.stdin.on('end', () => {
  console.error('[COROS MCP] stdin closed, exiting');
  process.exit(0);
});

process.on('error', (err) => {
  console.error('[COROS MCP] Error:', err);
  process.exit(1);
});

// Make sure we're in binary mode
if (process.stdin.setRawMode) {
  try {
    process.stdin.setRawMode(false);
  } catch (e) {
    // Ignore - setRawMode may not be available
  }
}
