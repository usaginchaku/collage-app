const DB_NAME = "naraberu-collage";
const STORE = "draft";
let connection;
const encodedImages = new WeakMap();

function openDB() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
      request.onblocked = () => {
        connection = null;
        reject(new Error("下書き保存が他のタブでブロックされています。"));
      };
    });
  return connection;
}

export async function loadDraft() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(state, assets) {
  const db = await openDB();
  // Some WebKit environments cannot persist Blob objects. Store their bytes instead,
  // and prepare them before opening a transaction (which otherwise becomes inactive).
  const images = await Promise.all(
    state.photos.map(async (photo) => {
      const blob = assets.get(photo.id).blob;
      if (!encodedImages.has(blob)) encodedImages.set(blob, blob.arrayBuffer());
      return {
        id: photo.id,
        bytes: await encodedImages.get(blob),
        type: blob.type,
      };
    }),
  );
  const data = { state, images };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(data, "current");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error || new Error("下書き保存が中断されました。"));
  });
}
