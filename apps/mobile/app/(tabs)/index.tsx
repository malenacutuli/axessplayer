// Home (Netflix-like): vertical list of rows from GET /feed/home, each a horizontal list of cards. Tap a
// card to open Watch. While the endpoint is not deployed (404) a calm "coming soon" state is shown.
// No em dashes.

import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { HomeRow } from "../../src/core/api/types";
import { useServices } from "../../src/state/ServicesProvider";
import { StateMessage } from "../../src/ui/StateMessage";
import { colors, space } from "../../src/ui/theme";
import { VideoCard } from "../../src/ui/VideoCard";

type Load = { status: "loading" } | { status: "ok"; rows: HomeRow[] } | { status: "unavailable" } | { status: "failed" };

export default function HomeScreen() {
  const { content } = useServices();
  const [state, setState] = useState<Load>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(140, Math.min(220, width * 0.42));

  const load = useCallback(async () => {
    const r = await content.getHome();
    if (r.ok) setState({ status: "ok", rows: r.data.rows });
    else setState({ status: r.reason === "not_found" ? "unavailable" : "failed" });
  }, [content]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (state.status === "loading") return <StateMessage title="Loading" loading />;
  if (state.status === "unavailable") return <StateMessage title="Home is coming soon" body="Try Shorts in the meantime." onRetry={load} />;
  if (state.status === "failed") return <StateMessage title="Could not load Home" body="Check your connection." onRetry={load} />;
  if (state.rows.length === 0) return <StateMessage title="Nothing here yet" body="New videos will show up here." onRetry={load} />;

  return (
    <FlatList
      style={styles.screen}
      data={state.rows}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
      contentContainerStyle={{ paddingVertical: space.lg, gap: space.xl }}
      renderItem={({ item: row }) => (
        <View style={styles.row}>
          <Text style={styles.rowTitle} accessibilityRole="header">
            {row.title}
          </Text>
          <FlatList
            horizontal
            data={row.items}
            keyExtractor={(v) => `${row.id}:${v.id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
            accessibilityLabel={`${row.title}, ${row.items.length} videos`}
            renderItem={({ item }) => (
              <VideoCard video={item} width={cardWidth} onPress={() => router.push(`/watch/${encodeURIComponent(item.id)}`)} />
            )}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: { gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 20, fontWeight: "700", paddingHorizontal: space.lg },
});
