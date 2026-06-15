// The wallet screen (presentation). Shows the balance, bonus balance, and entitlements from GET /wallet
// (server-authoritative; never computed locally). All numbers come from src/wallet/wallet.ts helpers over
// the server Wallet. No em dashes.

import { useEffect, useState, type FC } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client.js";
import type { Wallet } from "../api/types.js";
import { spendableCoins } from "../wallet/wallet.js";

export interface WalletScreenProps {
  client: ApiClient;
}

export const WalletScreen: FC<WalletScreenProps> = ({ client }) => {
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    let alive = true;
    void client.getWallet().then((w) => {
      if (alive) setWallet(w);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  if (!wallet) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>Loading wallet</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="wallet-screen">
      <Text style={styles.balance} testID="wallet-balance">
        {spendableCoins(wallet)} coins
      </Text>
      <Text style={styles.muted}>
        {wallet.balance} purchased + {wallet.bonus_balance} bonus
      </Text>
      <Text style={styles.section}>Unlocked</Text>
      {wallet.entitlements.map((e) => (
        <Text key={`${e.scope}:${e.scope_id}`} style={styles.entitlement}>
          {e.scope}: {e.scope_id}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, backgroundColor: "#000" },
  balance: { fontSize: 32, fontWeight: "700", color: "#fff" },
  muted: { fontSize: 14, color: "#aaa", marginTop: 4 },
  section: { fontSize: 18, color: "#fff", marginTop: 24 },
  entitlement: { fontSize: 14, color: "#9cf", marginTop: 6 },
});
