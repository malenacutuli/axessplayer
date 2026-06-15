// The vertical swipe feed screen (presentation). A paging FlatList of episode cards; swiping pages to the
// next card and that card's PlayerScreen drives the adaptive session. All data + ordering comes from
// src/feed/feed.ts (loadFeed), which is what the tests exercise. Rendering and gesture behavior are
// device-verified at integration time, not unit-tested here. No em dashes.

import { useEffect, useState, type FC } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client.js";
import { loadFeed, type FeedItem } from "../feed/feed.js";

export interface FeedScreenProps {
  client: ApiClient;
  seriesIds: readonly string[];
  onOpen: (item: FeedItem) => void;
}

export const FeedScreen: FC<FeedScreenProps> = ({ client, seriesIds, onOpen }) => {
  const [items, setItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    let alive = true;
    void loadFeed(client, seriesIds).then((res) => {
      if (alive) setItems(res.items);
    });
    return () => {
      alive = false;
    };
  }, [client, seriesIds]);

  return (
    <FlatList
      data={items}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      keyExtractor={(item) => item.key}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={`Play ${item.seriesTitle ?? "series"} episode ${item.episodeNumber}`}
          onPress={() => onOpen(item)}
          testID={`feed-card-${item.key}`}
        >
          <Text style={styles.title}>{item.seriesTitle ?? "Series"}</Text>
          <Text style={styles.subtitle}>
            Episode {item.episodeNumber}
            {item.episodeTitle ? `: ${item.episodeTitle}` : ""}
          </Text>
          <Text style={styles.badge}>{item.isFree ? "Free" : `${item.coinCost ?? 0} coins`}</Text>
        </Pressable>
      )}
    />
  );
};

const styles = StyleSheet.create({
  card: { flex: 1, justifyContent: "flex-end", padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 16, color: "#ddd", marginTop: 4 },
  badge: { fontSize: 14, color: "#9cf", marginTop: 8 },
});
