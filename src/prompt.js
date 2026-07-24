import readline from 'node:readline';

export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// Prompt without echoing input (for passwords / MFA codes).
export function askHidden(question) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r' || code === 4 /* EOT */) {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        } else if (code === 3 /* Ctrl-C */) {
          process.stdout.write('\n');
          process.exit(130);
        } else if (code === 127 || code === 8 /* backspace / delete */) {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}
