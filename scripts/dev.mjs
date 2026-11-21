import { spawn } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const env = { ...process.env, PORT: process.env.PORT ?? '8787', HOST: '127.0.0.1' };

const children = [];

function launch(label, command, args, color) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: isWindows });
  children.push(child);
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
    stream.on('end', () => {
      if (buffer) target.write(prefix + buffer + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(prefix + `进程退出，代码 ${code}`);
    shutdown();
  });
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

launch('api', process.execPath, ['server/index.ts'], '36');
launch('web', isWindows ? 'npx.cmd' : 'npx', ['vite', '--host', '127.0.0.1'], '35');

console.log('\n开发模式：前端 http://127.0.0.1:5173 （/api 已代理到 8787）\n');
