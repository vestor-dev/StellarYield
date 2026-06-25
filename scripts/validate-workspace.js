#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Paths relative to workspace root
const ROOT_DIR = path.resolve(__dirname, '..');
const WORKSPACES = [
  { name: 'client', dir: path.join(ROOT_DIR, 'client') },
  { name: 'server', dir: path.join(ROOT_DIR, 'server') },
  { name: 'emergency-ui', dir: path.join(ROOT_DIR, 'emergency-ui') },
  { name: 'packages/sdk', dir: path.join(ROOT_DIR, 'packages', 'sdk') },
  { name: 'backend/rewards', dir: path.join(ROOT_DIR, 'backend', 'rewards') },
  { name: 'backend/keepers', dir: path.join(ROOT_DIR, 'backend', 'keepers') },
  { name: 'frontend', dir: path.join(ROOT_DIR, 'frontend') }
];

function printStatus(checkName, success, errorMsg = '') {
  if (success) {
    console.log(`[\x1b[32mPASS\x1b[0m] ${checkName}`);
  } else {
    console.log(`[\x1b[31mFAIL\x1b[0m] ${checkName}`);
    if (errorMsg) {
      console.log(`       \x1b[33mError/Action:\x1b[0m ${errorMsg}`);
    }
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[match[1].trim()] = val;
      }
    });
    return env;
  } catch {
    return {};
  }
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.replace('v', '').split('.')[0], 10);
  const success = major >= 18;
  return {
    success,
    message: success ? '' : `Node.js version is ${version}. Version >= 18 is required. Please install Node v18+ from https://nodejs.org.`
  };
}

function checkRust() {
  try {
    const rustcVer = execSync('rustc --version', { stdio: 'pipe' }).toString().trim();
    const cargoVer = execSync('cargo --version', { stdio: 'pipe' }).toString().trim();
    return {
      success: true,
      message: `rustc: ${rustcVer}, cargo: ${cargoVer}`
    };
  } catch (error) {
    return {
      success: false,
      message: `Rust or Cargo compiler not found on PATH. Please install Rustup from https://rustup.rs to compile Soroban contracts.`
    };
  }
}

function checkWorkspaceDependencies() {
  const missing = [];
  WORKSPACES.forEach(ws => {
    const nodeModulesPath = path.join(ws.dir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      missing.push(ws.name);
    }
  });

  return {
    success: missing.length === 0,
    message: missing.length === 0 ? '' : `Dependencies are missing in: ${missing.join(', ')}. Please run 'npm install' or 'npm ci' in those directories.`
  };
}

function checkEnvFiles() {
  const issues = [];
  
  // Client env check
  const clientEnvLocal = path.join(ROOT_DIR, 'client', '.env.local');
  const clientEnv = path.join(ROOT_DIR, 'client', '.env');
  if (!fs.existsSync(clientEnvLocal) && !fs.existsSync(clientEnv)) {
    issues.push(`client/.env.local is missing (copy client/.env.example to client/.env.local)`);
  }

  // Server env check
  const serverEnv = path.join(ROOT_DIR, 'server', '.env');
  if (!fs.existsSync(serverEnv)) {
    issues.push(`server/.env is missing (copy server/.env.example to server/.env)`);
  }

  return {
    success: issues.length === 0,
    message: issues.length === 0 ? '' : issues.join('\n                     ')
  };
}

function checkNetworkReachability(rpcUrl) {
  return new Promise((resolve) => {
    if (!rpcUrl) {
      resolve({ success: false, message: 'No VITE_SOROBAN_RPC_URL configured in client env.' });
      return;
    }

    try {
      const parsedUrl = new URL(rpcUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getNetwork'
      });

      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 5000
      };

      const req = client.request(rpcUrl, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: '' });
          } else {
            resolve({ success: false, message: `Soroban RPC endpoint at ${rpcUrl} returned HTTP ${res.statusCode}.` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, message: `Could not connect to Soroban RPC at ${rpcUrl}. Reason: ${err.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, message: `Connection timeout to Soroban RPC at ${rpcUrl}.` });
      });

      req.write(payload);
      req.end();
    } catch (err) {
      resolve({ success: false, message: `Invalid RPC URL format: ${rpcUrl}. Error: ${err.message}` });
    }
  });
}

async function runValidation() {
  console.log('==================================================');
  console.log('StellarYield Workspace Prerequisites Validator');
  console.log('==================================================\n');

  let allPassed = true;

  // 1. Node.js check
  const nodeStatus = checkNodeVersion();
  printStatus('Node.js Runtime', nodeStatus.success, nodeStatus.message);
  if (!nodeStatus.success) allPassed = false;

  // 2. Rust/Cargo compiler check
  const rustStatus = checkRust();
  printStatus('Rust Compiler Toolchain', rustStatus.success, rustStatus.message);
  if (!rustStatus.success) allPassed = false;

  // 3. Workspaces node dependencies check
  const depsStatus = checkWorkspaceDependencies();
  printStatus('Workspaces Dependencies', depsStatus.success, depsStatus.message);
  if (!depsStatus.success) allPassed = false;

  // 4. Config Env Files check
  const envStatus = checkEnvFiles();
  printStatus('Environment Configuration Files', envStatus.success, envStatus.message);
  if (!envStatus.success) allPassed = false;

  // 5. Network reachability check (reads from client env)
  let rpcUrl = 'https://soroban-testnet.stellar.org';
  const clientEnvLocal = path.join(ROOT_DIR, 'client', '.env.local');
  const clientEnv = path.join(ROOT_DIR, 'client', '.env');
  const envs = Object.assign(
    {},
    parseEnvFile(clientEnv),
    parseEnvFile(clientEnvLocal)
  );
  if (envs.VITE_SOROBAN_RPC_URL) {
    rpcUrl = envs.VITE_SOROBAN_RPC_URL;
  }

  const netStatus = await checkNetworkReachability(rpcUrl);
  printStatus(`Soroban RPC Connection (${rpcUrl})`, netStatus.success, netStatus.message);
  if (!netStatus.success) allPassed = false;

  console.log('\n==================================================');
  if (allPassed) {
    console.log('\x1b[32mAll workspace prerequisites and configuration are valid!\x1b[0m');
    console.log('==================================================');
    process.exit(0);
  } else {
    console.log('\x1b[31mWorkspace configuration validation failed. Please fix issues listed above.\x1b[0m');
    console.log('==================================================');
    process.exit(1);
  }
}

if (require.main === module) {
  runValidation().catch(err => {
    console.error('Validation error:', err);
    process.exit(1);
  });
}

module.exports = {
  checkNodeVersion,
  checkRust,
  checkWorkspaceDependencies,
  checkEnvFiles,
  checkNetworkReachability,
  parseEnvFile,
};
