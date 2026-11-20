// Read only after the player chooses Import local records. Use the original
// Chromium storage partition and the game's origin. The import never deletes the source.
export async function readLegacyRecords(BrowserWindow, origin) {
    const reader = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
        await reader.loadURL(new URL('steam-record-import.html', origin).href);
        const collect = async () => {
            const result = { scores: [], stats: null, odyssey: localStorage.getItem('serenityBlocks_odysseyProgress'),
                solved: localStorage.getItem('serenity.stillfall.solved') || localStorage.getItem('serenity.faultLines.solved') };
            if (!(await indexedDB.databases()).some((db) => db.name === 'SerenityBlocksDB')) return result;
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('SerenityBlocksDB');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            try {
                const transaction = db.transaction(['highScores', 'statistics'], 'readonly');
                const read = (req) => new Promise((resolve, reject) => {
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                [result.scores, result.stats] = await Promise.all([read(transaction.objectStore('highScores').getAll()),
                    read(transaction.objectStore('statistics').get('stats'))]);
                return result;
            } finally { db.close(); }
        };
        return await reader.webContents.executeJavaScript('(' + collect.toString() + ')()');
    } finally { reader.destroy(); }
}
