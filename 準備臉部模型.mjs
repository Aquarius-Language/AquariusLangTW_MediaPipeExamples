// 在固定版本的模型前加入 RGBA → RGB、NCHW 與正規化運算，避免逐像素星泉呼叫。
// ONNX 欄位依據 https://github.com/onnx/onnx/blob/v1.18.0/onnx/onnx.proto。
import {readFile as 讀取檔案, writeFile as 寫入檔案} from 'node:fs/promises';
import {createHash as 建立雜湊} from 'node:crypto';

const 串接 = (...資料) => Buffer.concat(資料.flat());
function 整數編碼(值) {
    let 剩餘 = BigInt(值); const 資料 = [];
    do { const 位元組 = Number(剩餘 & 127n); 剩餘 >>= 7n; 資料.push(位元組 | (剩餘 ? 128 : 0)); } while (剩餘);
    return Buffer.from(資料);
}
function 讀取整數(資料, 起點) {
    let 值 = 0n, 位移 = 0n, 位置 = 起點;
    for (; 位置 < 資料.length && 位移 < 70n; 位移 += 7n) {
        const 位元組 = 資料[位置++]; 值 |= BigInt(位元組 & 127) << 位移;
        if (!(位元組 & 128)) return {值: Number(值), 位置};
    }
    throw new Error('ONNX 整數欄位無效。');
}
function 欄位列表(資料) {
    const 欄位 = []; let 位置 = 0;
    while (位置 < 資料.length) {
        const 起 = 位置, 標籤 = 讀取整數(資料, 位置); 位置 = 標籤.位置;
        const 編號 = Math.floor(標籤.值 / 8), 型別 = 標籤.值 % 8; let 起點 = 位置, 終點;
        if (型別 === 0) 終點 = 讀取整數(資料, 位置).位置;
        else if (型別 === 1) 終點 = 位置 + 8;
        else if (型別 === 5) 終點 = 位置 + 4;
        else if (型別 === 2) { const 長度 = 讀取整數(資料, 位置); 起點 = 長度.位置; 終點 = 起點 + 長度.值; }
        else throw new Error('ONNX 欄位型別不支援。');
        if (終點 > 資料.length) throw new Error('ONNX 欄位長度無效。');
        欄位.push({編號, 型別, 資料: 資料.subarray(起點, 終點), 原始: 資料.subarray(起, 終點)}); 位置 = 終點;
    }
    return 欄位;
}
const 訊息 = (編號, 資料) => 串接(整數編碼(編號 * 8 + 2), 整數編碼(資料.length), 資料);
const 文字 = (編號, 值) => 訊息(編號, Buffer.from(值));
const 整數 = (編號, 值) => 串接(整數編碼(編號 * 8), 整數編碼(值));
const 單一 = (資料, 編號) => { const 項目 = 欄位列表(資料).filter(項 => 項.編號 === 編號); if (項目.length !== 1) throw new Error('ONNX 模型介面不相容。'); return 項目[0].資料; };
const 整數屬性 = (名稱, 值) => 串接(文字(1, 名稱), 整數(3, 值), 整數(20, 2));
const 整數列屬性 = (名稱, 值) => 串接(文字(1, 名稱), 值.map(項 => 整數(8, 項)), 整數(20, 7));
const 節點 = (運算, 輸入, 輸出, 屬性 = []) => 訊息(1, 串接(輸入.map(名稱 => 文字(1, 名稱)), 文字(2, 輸出), 文字(3, 輸出), 文字(4, 運算), 屬性.map(項 => 訊息(5, 項))));
const 常數 = (名稱, 型別, 維度, 資料) => 訊息(5, 串接(維度.map(項 => 整數(1, 項)), 整數(2, 型別), 文字(8, 名稱), 訊息(9, 資料)));

async function 準備(來源, 目標, 尺寸, 偵測, 雜湊) {
    const 原始 = await 讀取檔案(new URL(來源, import.meta.url));
    if (建立雜湊('sha256').update(原始).digest('hex') !== 雜湊) throw new Error('臉部原始模型校驗失敗。');
    const 模型 = 欄位列表(原始), 圖形 = 單一(原始, 7), 欄位 = 欄位列表(圖形);
    const 輸入 = 單一(圖形, 11), 輸入名稱 = 單一(輸入, 1).toString();
    const 張量型別 = 單一(單一(輸入, 2), 1), 形狀 = 欄位列表(單一(張量型別, 2));
    if (讀取整數(單一(張量型別, 1), 0).值 !== 1 || 形狀.length !== 4 || 形狀.slice(1).some((項, 索引) => 讀取整數(單一(項.資料, 1), 0).值 !== [3, 尺寸, 尺寸][索引])) throw new Error('臉部原始模型尺寸不相容。');
    const 前綴 = '__aquarius_rgba_';
    if (原始.includes(Buffer.from(前綴))) throw new Error('ONNX 模型已包含影像輸入。');
    const 索引 = Buffer.alloc(24); [0n, 1n, 2n].forEach((值, 項) => 索引.writeBigInt64LE(值, 項 * 8));
    const 比例 = Buffer.alloc(4); 比例.writeFloatLE(偵測 ? 127.5 : 255);
    const 位移 = Buffer.alloc(4); 位移.writeFloatLE(1);
    const 節點列 = [
        節點('Gather', [前綴 + 'input', 前綴 + 'channels'], 前綴 + 'rgb', [整數屬性('axis', 3)]),
        節點('Cast', [前綴 + 'rgb'], 前綴 + 'float', [整數屬性('to', 1)]),
        節點('Transpose', [前綴 + 'float'], 前綴 + 'chw', [整數列屬性('perm', [0, 3, 1, 2])]),
        節點('Div', [前綴 + 'chw', 前綴 + 'scale'], 偵測 ? 前綴 + 'normalized' : 輸入名稱),
        ...(偵測 ? [節點('Sub', [前綴 + 'normalized', 前綴 + 'offset'], 輸入名稱)] : [])
    ];
    const 新形狀 = 串接([1, 尺寸, 尺寸, 4].map(值 => 訊息(1, 整數(1, 值))));
    const 新輸入 = 訊息(11, 串接(文字(1, 前綴 + 'input'), 訊息(2, 訊息(1, 串接(整數(1, 2), 訊息(2, 新形狀))))));
    const 新圖形 = 串接(節點列, 欄位.filter(項 => 項.編號 !== 11).map(項 => 項.原始), 常數(前綴 + 'channels', 7, [3], 索引), 常數(前綴 + 'scale', 1, [], 比例), 偵測 ? 常數(前綴 + 'offset', 1, [], 位移) : Buffer.alloc(0), 新輸入);
    await 寫入檔案(new URL(目標, import.meta.url), 串接(模型.map(項 => 項.編號 === 7 ? 訊息(7, 新圖形) : 項.原始)));
}
await 準備('模型/臉部偵測.onnx', '模型/臉部偵測影像.onnx', 128, true, '2f2689b040becf555706d2cb978d2f0e3296ea82413734fba9a856c66c5f2b17');
await 準備('模型/臉部關鍵點.onnx', '模型/臉部關鍵點影像.onnx', 192, false, '3ca77cf59c18e4da0eccb46695bf604683fa564253e3385892981a5c274fb10f');
