import type { SavedScene } from "./scene-library";
import { sceneSignature } from "./scene-signature";

interface Snapshot {
  id: string;
  version: 1;
  signature: string;
  updated: number;
  image: Blob;
}
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("soundspectra-scene-snapshots", 1);
    let expired = false;
    const timer = window.setTimeout(() => {
      expired = true;
      reject(new Error("缩略图存储暂不可用"));
    }, 2500);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("snapshots", { keyPath: "id" });
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  }));
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", mode);
    const timer = window.setTimeout(() => tx.abort(), 2500);
    let result: () => T;
    tx.oncomplete = () => {
      clearTimeout(timer);
      try {
        resolve(result());
      } catch (error) {
        reject(error);
      }
    };
    tx.onabort = tx.onerror = () => {
      clearTimeout(timer);
      reject(tx.error ?? new Error("缩略图存储失败"));
    };
    try {
      result = run(tx.objectStore("snapshots"));
    } catch (error) {
      clearTimeout(timer);
      tx.abort();
      reject(error);
    }
  });
}

export async function writeSceneSnapshot(item: SavedScene, image: Blob) {
  if (
    !["image/webp", "image/png"].includes(image.type) ||
    !image.size ||
    image.size > 256 * 1024
  )
    throw new Error("缩略图格式或大小无效");
  const db = await database();
  await transaction(db, "readwrite", (store) => {
    store.put({
      id: item.id,
      version: 1,
      signature: sceneSignature(item.scene),
      updated: item.updated,
      image,
    } satisfies Snapshot);
    // Bound the cache, retaining recent deletions so undo can restore their images.
    const all = store.getAll();
    all.onsuccess = () =>
      (all.result as Snapshot[])
        .sort((a, b) => b.updated - a.updated)
        .slice(80)
        .forEach((value) => store.delete(value.id));
    return () => undefined;
  });
  window.dispatchEvent(
    new CustomEvent("scene-snapshots-changed", { detail: item.id }),
  );
}

export async function readSceneSnapshot(
  id: string,
  signature: string,
  updated: number,
) {
  const db = await database();
  const value = await transaction<Snapshot | undefined>(
    db,
    "readonly",
    (store) => {
      const request = store.get(id);
      return () => request.result;
    },
  );
  if (
    value?.version !== 1 ||
    value.signature !== signature ||
    value.updated !== updated ||
    !(value.image instanceof Blob) ||
    !["image/webp", "image/png"].includes(value.image.type) ||
    !value.image.size ||
    value.image.size > 256 * 1024
  )
    return undefined;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(value.image);
  });
}
