#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const server = spawn('node', ['index.js'], {
  cwd: path.join(__dirname, 'server'),
  stdio: 'inherit',
  shell: true,
});

const client = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'client'),
  stdio: 'inherit',
  shell: true,
});

process.on('SIGINT', () => { server.kill(); client.kill(); process.exit(); });
process.on('exit', () => { server.kill(); client.kill(); });
