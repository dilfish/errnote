import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { createApp } from './app.ts';
import { ensureConfigFile, loadConfig, isTextAiReady, isVisionAiReady } from './config.ts';
import { openDb, ProblemRepo } from './db.ts';
import { dataDir, dbFile, distDir, ensureDataDirs } from './paths.ts';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const shouldOpen = process.argv.includes('--open');

ensureDataDirs();
ensureConfigFile();

const db = openDb(dbFile());
const repo = new ProblemRepo(db);
const server = http.createServer(createApp({ repo }));

function lanAddresses(): string[] {
  const list: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return list;
}

server.listen(port, host, () => {
  const config = loadConfig();
  console.log('');
  console.log('  错题本已启动');
  console.log(`  本机访问   http://localhost:${port}`);
  for (const address of lanAddresses()) console.log(`  手机访问   http://${address}:${port}`);
  console.log(`  数据目录   ${dataDir()}`);
  console.log(`  配置文件   ${dataDir()}/config.json`);
  console.log(
    `  AI 状态    ${isTextAiReady(config) ? '文本模型已配置' : '未配置（请在 config.json 填 apiKey）'} / ${
      isVisionAiReady(config) ? '视觉模型已就绪' : '视觉模型未就绪'
    }`,
  );
  if (!fs.existsSync(distDir())) {
    console.log('  提示       前端未构建：先运行 npm run build（开发时用 npm run dev）');
  }
  console.log('');

  if (shouldOpen) {
    const url = `http://localhost:${port}`;
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`  请手动打开 ${url}`));
    child.unref();
  }
});

function shutdown(signal: string): void {
  console.log(`\n收到 ${signal}，正在关闭…`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
