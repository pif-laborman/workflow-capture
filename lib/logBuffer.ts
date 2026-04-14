const buffer: string[] = [];
let intercepting = false;
let originalLog: typeof console.log;

export function startCapture() {
  if (intercepting) return;
  intercepting = true;
  buffer.length = 0;
  originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    buffer.push(line);
    originalLog.apply(console, args);
  };
}

export function stopCapture() {
  if (!intercepting) return;
  intercepting = false;
  console.log = originalLog;
}

export function getLogs(): string {
  return buffer.join('\n');
}
