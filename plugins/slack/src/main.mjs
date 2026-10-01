import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from './store.mjs';
import { Gateway } from './gateway.mjs';
import { SlackIO } from './slack-io.mjs';
import { SlackPlugin } from './plugin.mjs';

export function configuration(env = process.env) {
  const required = ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN', 'CONTEXT_GUARD_GATEWAY_TOKEN', 'CONTEXT_GUARD_CLOUD_ORIGIN'];
  for (const name of required) if (!env[name]) throw new Error(`Missing ${name}`);
  const teamId = env.SLACK_TEAM_ID || 'T0BRW7G4Q6P';
  if (teamId !== 'T0BRW7G4Q6P') throw new Error('This installation is restricted to Jerry Family');
  return { appToken: env.SLACK_APP_TOKEN, botToken: env.SLACK_BOT_TOKEN, gatewayToken: env.CONTEXT_GUARD_GATEWAY_TOKEN,
    gatewayUrl: env.CONTEXT_GUARD_GATEWAY_URL || 'http://127.0.0.1:8790', cloudOrigin: env.CONTEXT_GUARD_CLOUD_ORIGIN,
    directory: env.CONTEXT_GUARD_SLACK_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'context-guard-slack'), teamId };
}
async function lock(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'process.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await fs.open(filename, 'wx', 0o600); await handle.writeFile(String(process.pid)); await handle.close(); return () => fs.unlink(filename); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(filename, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid Slack process lock; inspect private state');
      try { process.kill(pid, 0); throw new Error('Slack plugin already running'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; await fs.unlink(filename); }
    }
  }
  throw new Error('Cannot acquire Slack process lock');
}
export async function start(config = configuration()) {
  const release = await lock(config.directory);
  let socket, plugin;
  const logger = { debug() {}, info() {}, warn() { console.warn('Slack SDK warning'); }, error() { console.error('Slack SDK failure'); }, getLevel: () => 'error', setLevel() {}, setName() {} };
  try {
    const store = await new Store(config.directory).open();
    const client = new WebClient(config.botToken, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000, logger });
    const authentication = await client.auth.test();
    if (authentication.team_id !== config.teamId || !authentication.user_id) throw new Error('Slack token is not installed in Jerry Family');
    const gateway = new Gateway({ url: config.gatewayUrl, token: config.gatewayToken, teamId: config.teamId });
    const io = new SlackIO({ client, store, botUserId: authentication.user_id, botToken: config.botToken });
    plugin = new SlackPlugin({ store, gateway, io, teamId: config.teamId, cloudOrigin: config.cloudOrigin, botUserId: authentication.user_id });
    socket = new SocketModeClient({ appToken: config.appToken, logger, clientOptions: { retryConfig: { retries: 0 } } });
    socket.on('slack_event', envelope => { void plugin.receive(envelope).catch(() => console.error('Slack envelope not acknowledged; journal unavailable')); });
    socket.on('error', () => console.error('Slack socket error'));
    await socket.start(); plugin.start();
    return { plugin, store, async stop() { await socket.disconnect(); await plugin.stop(); await release(); } };
  } catch (error) { await socket?.disconnect().catch(() => {}); await plugin?.stop(); await release(); throw error; }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  start().then(service => {
    console.info('Slack plugin started (Jerry Family)');
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; service.stop().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }).catch(error => { console.error('Slack plugin failed to start', error.code || 'CONFIGURATION_OR_STARTUP_ERROR'); process.exitCode = 1; });
}
