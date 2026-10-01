// Shorts (TikTok-like): full-screen vertical pager over GET /feed/shorts. Exactly one item plays (the
// visible one, only while this tab is focused and the app is in the foreground), the next one is
// preloaded, the previous stays mounted paused, everything else is released (src/core/feed/shorts.ts).
// Pages are requested by cursor as the viewer nears the end. No em dashes.

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from "react-native";

import type { Video } from "../../src/core/api/types";
import {
  appendPage,
  indexFromOffset,
  initialShortsState,
  playbackWindow,
  roleOf,
  shouldLoadMore,
  type ShortsState,
} from "../../src/core/feed/shorts";
import { useServices } from "../../src/state/ServicesProvider";
import { useSystemA11y } from "../../src/state/useSystemA11y";
import { ShortsItem, ShortsPlaceholder } from "../../src/ui/ShortsItem";
import { StateMessage } from "../../src/ui/StateMessage";
import { colors } from "../../src/ui/theme";

export default function ShortsScreen() {
  const { content } = useServices();
  const { reduceMotion } = useSystemA11y();
  const [state, setState] = useState<ShortsState>(initialShortsState);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(0);
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const listRef = useRef<FlatList<Video>>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setForeground(s === "active"));
    return () => sub.remove();
  }, []);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.loading || s.done) return;
    setState((p) => ({ ...p, loading: true }));
    const r = await content.getShorts(s.cursor);
    if (r.ok) setState((p) => appendPage(p, r.data));
    else setState((p) => ({ ...p, loading: false, error: r.reason === "not_found" ? "unavailable" : "failed" }));
  }, [content]);

  useEffect(() => {
    if (shouldLoadMore(state, active)) loadMore();
  }, [active, state, loadMore]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Video>[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first && first.index !== null) setActive(first.index);
  }).current;

  const goTo = useCallback(
    (index: number) => {
      const len = stateRef.current.items.length;
      if (index < 0 || index >= len) return;
      setActive(index);
      listRef.current?.scrollToIndex({ index, animated: !reduceMotion });
    },
    [reduceMotion]
  );

  const onLayout = (e: LayoutChangeEvent) => setHeight(Math.round(e.nativeEvent.layout.height));

  const retry = () => {
    setState(initialShortsState);
    setActive(0);
  };

  if (state.items.length === 0) {
    if (state.error === "unavailable") return <StateMessage title="Shorts are coming soon" body="Check back shortly." onRetry={retry} />;
    if (state.error === "failed") return <StateMessage title="Could not load Shorts" body="Check your connection." onRetry={retry} />;
    if (state.done) return <StateMessage title="No shorts yet" onRetry={retry} />;
    return <StateMessage title="Loading" loading />;
  }

  const win = playbackWindow(active, state.items.length);
  const playable = focused && foreground;

  return (
    <View style={styles.screen} onLayout={onLayout}>
      {height > 0 ? (
        <FlatList
          ref={listRef}
          data={state.items}
          keyExtractor={(v) => v.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={height}
          snapToAlignment="start"
          disableIntervalMomentum
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onMomentumScrollEnd={(e) => setActive(indexFromOffset(e.nativeEvent.contentOffset.y, height, state.items.length))}
          extraData={`${active}:${playable}:${reduceMotion}`}
          renderItem={({ item, index }) => {
            const role = roleOf(index, win);
            if (role === "released") return <ShortsPlaceholder video={item} height={height} />;
            return (
              <ShortsItem
                video={item}
                role={role}
                height={height}
                focused={playable}
                reduceMotion={reduceMotion}
                onNext={() => goTo(index + 1)}
                onPrevious={() => goTo(index - 1)}
              />
            );
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
});
