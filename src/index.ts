import * as readline from "readline";
import * as fs from "fs";
import * as qrcode from "qrcode-terminal";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { config } from "./config";
import { loadStorage } from "./storage";
import { setupHandlers } from "./handler";

const SESSION_FILE = ".session";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  loadStorage();

  let sessionString = config.session;
  if (!sessionString && fs.existsSync(SESSION_FILE)) {
    sessionString = fs.readFileSync(SESSION_FILE, "utf-8").trim();
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
    useWSS: true,
  });

  await client.connect();
  console.log("🔐 Подключились к Telegram");

  if (!await client.isUserAuthorized()) {
    console.log("\n📱 Авторизация через QR-код");
    console.log("Открой Telegram → Настройки → Устройства → Подключить устройство\n");

    await client.signInUserWithQrCode(
      { apiId: config.apiId, apiHash: config.apiHash },
      {
        qrCode: async (code) => {
          const url = `tg://login?token=${code.token.toString("base64url")}`;
          qrcode.generate(url, { small: true });
          console.log("⏳ Жди сканирования...\n");
        },
        password: async () => prompt("🔒 Пароль 2FA: "),
        onError: async (err) => { console.error("❌ Ошибка:", err.message); return false; },
      }
    );

    const savedSession = client.session.save() as unknown as string;
    fs.writeFileSync(SESSION_FILE, savedSession, "utf-8");
    console.log("💾 Сессия сохранена в .session\n");
  }

  const me = await client.getMe();
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ");
  console.log(`✅ Вошли как: ${name}${me.username ? ` (@${me.username})` : ""}`);
  console.log(`🆔 Ваш ID: ${me.id}`);

  setupHandlers(client, BigInt(me.id.toString()));

  console.log("\n🤖 Автоответчик активен! Отправь /help в Избранное.\n");

  await new Promise<void>(() => {});
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
