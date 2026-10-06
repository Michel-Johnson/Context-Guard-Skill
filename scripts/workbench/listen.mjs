export function canRetryWorkbenchListen(error, port, attempt, platform = process.platform) {
  if (port === 0 || attempt >= 20) return false;
  return error?.code === 'EADDRINUSE' || platform === 'win32' && error?.code === 'EACCES'
    && error.syscall === 'listen' && error.address === '127.0.0.1' && error.port === port + attempt;
}
