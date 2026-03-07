import axios from "axios";
import { prisma } from "../db";
import { config } from "../config";

const POLL_INTERVAL_MS = 15_000;

function getToncenterBase() {
  return config.tonTestnet
    ? "https://testnet.toncenter.com/api/v2"
    : "https://toncenter.com/api/v2";
}

async function checkPendingPayments() {
  if (!config.tonWallet || !config.toncenterApiKey) return;

  const pending = await prisma.tonPayment.findMany({
    where: { status: "pending" },
  });
  if (pending.length === 0) return;

  let transactions: any[];
  try {
    const resp = await axios.get(`${getToncenterBase()}/getTransactions`, {
      params: {
        address: config.tonWallet,
        limit: 50,
        api_key: config.toncenterApiKey,
      },
      timeout: 10_000,
    });
    transactions = resp.data?.result ?? [];
  } catch (err: any) {
    console.warn("[tonChecker] Failed to fetch transactions:", err?.message ?? err);
    return;
  }

  for (const payment of pending) {
    const match = transactions.find((tx: any) => {
      const comment: string = tx.in_msg?.message ?? "";
      return comment.trim() === payment.orderId;
    });

    if (!match) continue;

    // Verify amount (in nanotons: 1 TON = 1e9 nanotons)
    const receivedNano: number = parseInt(match.in_msg?.value ?? "0", 10);
    const expectedNano = payment.amountTon * 1e9;
    if (receivedNano < expectedNano * 0.99) {
      console.log(`[tonChecker] Payment ${payment.orderId}: amount mismatch (got ${receivedNano}, expected ${expectedNano})`);
      continue;
    }

    // Credit tokens to user
    await prisma.$transaction([
      prisma.tonPayment.update({
        where: { id: payment.id },
        data: { status: "paid", paidAt: new Date() },
      }),
      prisma.user.update({
        where: { id: payment.userId },
        data: { tokens: { increment: payment.tokens } },
      }),
    ]);

    console.log(`[tonChecker] Payment ${payment.orderId} confirmed — credited ${payment.tokens} tokens to user ${payment.userId}`);
  }
}

export function startTonChecker() {
  if (!config.tonWallet || !config.toncenterApiKey) {
    console.log("[tonChecker] TON_WALLET or TONCENTER_API_KEY not set, skipping");
    return;
  }
  console.log("[tonChecker] Started, polling every", POLL_INTERVAL_MS / 1000, "s");
  setInterval(checkPendingPayments, POLL_INTERVAL_MS);
}
