import net from 'net';
import tls from 'tls';

type MailInput = {
  to: string;
  subject: string;
  text: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number.parseInt(process.env.SMTP_PORT ?? '', 10);
  const secure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() !== 'false';
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !Number.isFinite(port) || !from) {
    throw new Error('SMTP is not fully configured.');
  }

  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
    from,
  };
}

function createReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = '';
  const queue: string[] = [];
  let pending: ((value: string) => void) | null = null;

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (buffer.includes('\r\n')) {
      const index = buffer.indexOf('\r\n');
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (/^\d{3} /.test(line)) {
        if (pending) {
          const resolve = pending;
          pending = null;
          resolve(line);
        } else {
          queue.push(line);
        }
      }
    }
  });

  return () =>
    new Promise<string>((resolve) => {
      const next = queue.shift();
      if (next) {
        resolve(next);
        return;
      }
      pending = resolve;
    });
}

async function expectResponse(
  readResponse: () => Promise<string>,
  expectedCodes: number[]
): Promise<void> {
  const line = await readResponse();
  const code = Number.parseInt(line.slice(0, 3), 10);
  if (!expectedCodes.includes(code)) {
    throw new Error(`SMTP unexpected response: ${line}`);
  }
}

async function sendCommand(
  socket: net.Socket | tls.TLSSocket,
  readResponse: () => Promise<string>,
  command: string,
  expectedCodes: number[]
): Promise<void> {
  socket.write(`${command}\r\n`);
  await expectResponse(readResponse, expectedCodes);
}

function createMessage(config: SmtpConfig, mail: MailInput): string {
  const lines = [
    `From: ${config.from}`,
    `To: ${mail.to}`,
    `Subject: ${mail.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    mail.text,
  ];
  return `${lines.join('\r\n')}\r\n.`;
}

export async function sendMail(mail: MailInput): Promise<void> {
  const config = getSmtpConfig();
  const socket = config.secure
    ? tls.connect({
        host: config.host,
        port: config.port,
        servername: config.host,
      })
    : net.createConnection({
        host: config.host,
        port: config.port,
      });

  const readResponse = createReader(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', (error) => reject(error));
  });

  await expectResponse(readResponse, [220]);
  await sendCommand(socket, readResponse, `EHLO ${config.host}`, [250]);

  if (config.user && config.pass) {
    const authPayload = Buffer.from(`\u0000${config.user}\u0000${config.pass}`, 'utf8').toString(
      'base64'
    );
    await sendCommand(socket, readResponse, `AUTH PLAIN ${authPayload}`, [235]);
  }

  await sendCommand(socket, readResponse, `MAIL FROM:<${config.from}>`, [250]);
  await sendCommand(socket, readResponse, `RCPT TO:<${mail.to}>`, [250, 251]);
  await sendCommand(socket, readResponse, 'DATA', [354]);
  socket.write(`${createMessage(config, mail)}\r\n`);
  await expectResponse(readResponse, [250]);
  await sendCommand(socket, readResponse, 'QUIT', [221]);
  socket.end();
}
