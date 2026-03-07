import * as dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env variable: ${name}`);
  return val;
}

export const config = {
  telegramApiId: parseInt(required("TELEGRAM_API_ID")),
  telegramApiHash: required("TELEGRAM_API_HASH"),
  port: parseInt(process.env.PORT || "3000"),
  toncenterApiKey: process.env.TONCENTER_API_KEY || "",
  tonWallet: process.env.TON_WALLET || "",
  tonTestnet: process.env.TON_TESTNET === "true",
};
