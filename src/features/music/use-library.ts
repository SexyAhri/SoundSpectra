import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "../spectrum/bridge";
import { musicClient } from "./client";
import type { Page, Playlist, Track, BrowseState } from "./types";

export function useLibrary(
  connected: boolean,
  initial?: BrowseState,
  searchQuery = "",
) {
  const [collection, setCollection] = useState(
    initial?.collection ?? "created",
  );
  const [playlists, setPlaylists] = useState<Page<Playlist> | null>(null);
  const [selected, setSelected] = useState<Playlist | null>(
    initial?.selected ?? null,
  );
  const [tracks, setTracks] = useState<Page<Track> | null>(null);
  const [listBusy, setListBusy] = useState(false),
    [trackBusy, setTrackBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null),
    [trackError, setTrackError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const listEpoch = useRef(0),
    trackEpoch = useRef(0);
  const listsFlight = useRef(false),
    tracksFlight = useRef(false);
  const loadLists = useCallback(
    async (offset = 0) => {
      if (!connected || listsFlight.current) return;
      listsFlight.current = true;
      setListBusy(true);
      setListError(null);
      const epoch = listEpoch.current;
      try {
        const page = await musicClient.playlists(collection, offset);
        if (epoch === listEpoch.current)
          setPlaylists((old) => ({
            ...page,
            items: offset ? [...(old?.items ?? []), ...page.items] : page.items,
          }));
      } catch (e) {
        if (epoch === listEpoch.current) setListError(describeError(e));
      } finally {
        if (epoch === listEpoch.current) {
          listsFlight.current = false;
          setListBusy(false);
        }
      }
    },
    [connected, collection],
  );
  const previousList = useRef({ connected, collection });
  useEffect(() => {
    listEpoch.current++;
    trackEpoch.current++;
    listsFlight.current = false;
    tracksFlight.current = false;
    setPlaylists(null);
    if (
      previousList.current.connected !== connected ||
      previousList.current.collection !== collection
    )
      setSelected(null);
    previousList.current = { connected, collection };
    setTracks(null);
    setListError(null);
    setTrackError(null);
    setTrackBusy(false);
    setListBusy(false);
    if (connected) void loadLists();
    return () => {
      listEpoch.current++;
      trackEpoch.current++;
    };
  }, [connected, collection, loadLists]);
  const select = (playlist: Playlist) => {
    trackEpoch.current++;
    tracksFlight.current = false;
    setSelected(playlist);
    setTracks(null);
    setTrackBusy(false);
    setTrackError(null);
  };
  const loadTracks = useCallback(
    async (offset = 0, all = false) => {
      if (!selected || tracksFlight.current) return;
      tracksFlight.current = true;
      setTrackBusy(true);
      setTrackError(null);
      const epoch = trackEpoch.current;
      try {
        if (selected.id === "__remote") {
          if (!searchQuery.trim()) {
            setTracks(null);
            return;
          }
          const page = await musicClient.search(searchQuery, offset);
          if (epoch === trackEpoch.current)
            setTracks((old) => ({
              ...page,
              items: offset
                ? [...(old?.items ?? []), ...page.items]
                : page.items,
            }));
          return;
        }
        if (selected.id.startsWith("__")) {
          const local = await musicClient.indexed(
            null,
            selected.id === "__recent",
          );
          if (epoch === trackEpoch.current && local) {
            setComplete(local.complete);
            setTracks({
              items: local.items,
              total: local.total,
              nextOffset: null,
              filtered: 0,
            });
          }
          return;
        }
        let holdCached = false;
        let refreshed: Page<Track> | null = null;
        if (offset === 0) {
          const local = await musicClient
            .indexed(selected.id)
            .catch(() => null);
          if (epoch === trackEpoch.current)
            setComplete(local?.complete ?? false);
          if (local?.items.length && epoch === trackEpoch.current)
            setTracks({
              items: local.items,
              total: local.total,
              nextOffset: local.complete ? null : (local.nextOffset ?? 0),
              filtered: 0,
            });
          if (local?.complete) {
            all = true;
            holdCached = local.items.length > 0;
          }
        }
        let next: number | null = offset;
        do {
          const page: Page<Track> = await musicClient.tracks(selected.id, next);
          if (epoch !== trackEpoch.current) return;
          setComplete(page.nextOffset === null);
          const append = next !== 0;
          const merge = (old: Page<Track> | null): Page<Track> => {
            const seen = new Set(append ? old?.items.map((t) => t.id) : []);
            return {
              ...page,
              filtered: page.filtered + (append ? (old?.filtered ?? 0) : 0),
              items: [
                ...(append ? (old?.items ?? []) : []),
                ...page.items.filter((t) => {
                  if (seen.has(t.id)) return false;
                  seen.add(t.id);
                  return true;
                }),
              ],
            };
          };
          if (holdCached) {
            refreshed = merge(refreshed);
            if (page.nextOffset === null) setTracks(refreshed);
          } else setTracks(merge);
          if (page.nextOffset !== null && page.nextOffset <= next)
            throw Error("歌单分页未前进，请重试");
          next = page.nextOffset;
        } while (all && next !== null && epoch === trackEpoch.current);
      } catch (e) {
        if (epoch === trackEpoch.current) setTrackError(describeError(e));
      } finally {
        if (epoch === trackEpoch.current) {
          tracksFlight.current = false;
          setTrackBusy(false);
        }
      }
    },
    [selected, searchQuery],
  );
  useEffect(() => {
    if (selected) void loadTracks();
    return () => {
      trackEpoch.current++;
      tracksFlight.current = false;
    };
  }, [selected, loadTracks]);
  return {
    collection,
    setCollection,
    playlists,
    selected,
    select,
    back: () => {
      trackEpoch.current++;
      tracksFlight.current = false;
      setSelected(null);
      setTracks(null);
      setTrackBusy(false);
      setTrackError(null);
    },
    tracks,
    complete,
    listBusy,
    trackBusy,
    listError,
    trackError,
    loadLists,
    loadTracks,
    cancelLoading: () => {
      trackEpoch.current++;
      tracksFlight.current = false;
      setTrackBusy(false);
    },
  };
}
