import {createServer as 建立伺服器} from 'node:http';
import {readFile as 讀取檔案, writeFile as 寫入檔案, mkdir as 建立目錄} from 'node:fs/promises';
import 路徑 from 'node:path';
import {fileURLToPath as 網址轉路徑, pathToFileURL as 路徑轉網址} from 'node:url';
import 驗證 from 'node:assert/strict';
const 根目錄 = 路徑.resolve(網址轉路徑(new URL('../', import.meta.url)));
const {chromium: 瀏覽器引擎} = await import(process.env.AQUARIUS_PLAYWRIGHT ?? 'playwright').catch(() => import(路徑轉網址(路徑.resolve(根目錄, '../AquariusLangTW/AquariusWebCompiler/node_modules/playwright/index.mjs')).href));
const 報告目錄 = 路徑.join(根目錄, 'dist/驗證');
await 建立目錄(報告目錄, {recursive: true});
const 伺服器 = 建立伺服器(async (請求, 回應) => {
    try {
        const 名稱 = decodeURIComponent(new URL(請求.url, 'http://localhost').pathname);
        const 網頁根 = 路徑.join(根目錄, 'web');
        const 檔案 = 名稱 === '/fixture.png' ? 路徑.join(根目錄, '驗證資料/攝影機.png') : 路徑.resolve(網頁根, '.' + 名稱.slice('/project'.length) + (名稱.endsWith('/') ? 'index.html' : ''));
        if (名稱 !== '/fixture.png' && (!名稱.startsWith('/project/') || !檔案.startsWith(網頁根 + 路徑.sep))) throw new Error('路徑無效');
        回應.setHeader('Content-Type', ({'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png'})[路徑.extname(檔案)] ?? 'application/octet-stream');
        回應.end(await 讀取檔案(檔案));
    } catch { 回應.statusCode = 404; 回應.end('找不到檔案'); }
});
await new Promise(完成 => 伺服器.listen(0, '127.0.0.1', 完成));
const 瀏覽器 = await 瀏覽器引擎.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + 路徑.join(根目錄, '驗證資料/攝影機.y4m')]});
const 錯誤 = [];
const 結果 = {};
try {
    const 環境 = await 瀏覽器.newContext({permissions: ['camera'], viewport: {width: 1040, height: 760}});
    const 網頁 = await 環境.newPage();
    網頁.on('pageerror', 例外 => 錯誤.push(例外.message));
    網頁.on('console', 訊息 => { if (訊息.type() === 'error') console.error(訊息.text()); });
    await 網頁.goto(`http://127.0.0.1:${伺服器.address().port}/project/?autorun=0`);
    await 網頁.waitForFunction(() => window.aquarius);
    驗證.equal(await 網頁.title(), '星泉視覺實驗室');
    for (const 項目 of [['姿態驗證.aqua', '姿態模型推論驗證通過'], ['臉部驗證.aqua', '臉部模型推論驗證通過'], ['圖形加速驗證.aqua', '圖形加速姿態推論驗證通過'], ['臉部圖形加速驗證.aqua', '圖形加速臉部推論驗證通過']]) {
        const 推論 = await 網頁.evaluate(入口 => window.aquarius.run(入口), 項目[0]);
        驗證.ok(推論.output.includes(項目[1]), 推論.output);
        結果[項目[0]] = true;
    }
    await 網頁.evaluate(() => { window.執行 = window.aquarius.run('星泉視覺實驗室.aqua').catch(例外 => { window.例外 = 例外.message; }); });
    await 網頁.waitForFunction(() => window.aquarius.host.processing.frameCount >= 2);
    await 網頁.screenshot({path: 路徑.join(報告目錄, '姿態待機.png')});
    await 網頁.mouse.click(790, 244);
    await 網頁.waitForTimeout(100);
    await 網頁.screenshot({path: 路徑.join(報告目錄, '範例選單.png')});
    await 網頁.mouse.click(790, 353);
    await 網頁.waitForTimeout(100);
    await 網頁.screenshot({path: 路徑.join(報告目錄, '臉部待機.png')});
    await 網頁.mouse.click(790, 430);
    try { await 網頁.waitForFunction(() => window.aquarius.host.cache.get('臉部模型.aqua').scope.get('有人物') === true, null, {timeout: 60000}); }
    catch (例外) { await 網頁.screenshot({path: 路徑.join(報告目錄, '臉部失敗.png')}); throw 例外; }
    const 首次影格 = await 網頁.evaluate(() => window.aquarius.host.processing.frameCount);
    await 網頁.waitForFunction(影格 => window.aquarius.host.processing.frameCount >= 影格 + 5, 首次影格, {timeout: 60000});
    const 中央處理器座標 = await 網頁.evaluate(() => window.aquarius.host.cache.get('臉部模型.aqua').scope.get('關鍵點').map(值 => 值.value));
    結果.臉部 = await 網頁.evaluate(() => {
        const 模型 = window.aquarius.host.cache.get('臉部模型.aqua').scope;
        return {關鍵點數: 模型.get('關鍵點').length / 3, 信心: 模型.get('信心').value, 處理毫秒: 模型.get('耗時').value};
    });
    驗證.equal(結果.臉部.關鍵點數, 468);
    驗證.ok(結果.臉部.信心 >= 0.75);
    await 網頁.screenshot({path: 路徑.join(報告目錄, '臉部攝影機.png')});
    // 運作中切換，確認上一個範例的攝影機、模型與結果全部釋放。
    await 網頁.mouse.click(790, 244); await 網頁.mouse.click(790, 303);
    await 網頁.waitForFunction(() => window.aquarius.host.onnx.sessions.size === 0 && window.aquarius.host.webcam.sessions.size === 0);
    驗證.equal(await 網頁.evaluate(() => window.aquarius.host.cache.get('臉部模型.aqua').scope.get('關鍵點').length), 0);
    await 網頁.mouse.click(790, 430);
    await 網頁.waitForFunction(() => window.aquarius.host.pose.trackers.size === 1 && window.aquarius.host.onnx.sessions.size === 2 && window.aquarius.host.webcam.sessions.size === 1);
    await 網頁.mouse.click(790, 503);
    await 網頁.waitForFunction(() => window.aquarius.host.onnx.sessions.size === 0 && window.aquarius.host.webcam.sessions.size === 0);
    // 鍵盤開啟選單、選取臉部，然後啟動 WebGPU。
    await 網頁.keyboard.press('Enter'); await 網頁.keyboard.press('ArrowDown'); await 網頁.keyboard.press('Enter');
    await 網頁.mouse.click(790, 357);
    await 網頁.waitForFunction(() => window.aquarius.host.cache.get('臉部模型.aqua').scope.get('有人物') === true, null, {timeout: 60000});
    驗證.ok(await 網頁.evaluate(() => [...window.aquarius.host.onnx.sessions].every(工作 => 工作.provider === 'WebGPU')));
    const 圖形加速座標 = await 網頁.evaluate(() => window.aquarius.host.cache.get('臉部模型.aqua').scope.get('關鍵點').map(值 => 值.value));
    驗證.equal(中央處理器座標.length, 1404); 驗證.equal(圖形加速座標.length, 1404);
    let 差異 = 0;
    for (let 項 = 0; 項 < 468; 項++) 差異 += Math.hypot((中央處理器座標[項 * 3] - 圖形加速座標[項 * 3]) * 640, (中央處理器座標[項 * 3 + 1] - 圖形加速座標[項 * 3 + 1]) * 480);
    結果.臉部.後端平均座標差異像素 = 差異 / 468;
    驗證.ok(差異 / 468 < 3, 'CPU 與 WebGPU 的臉部座標差異過大。');
    await 網頁.mouse.click(790, 503);
    await 網頁.waitForFunction(() => window.aquarius.host.onnx.sessions.size === 0 && window.aquarius.host.webcam.sessions.size === 0);
    結果.下拉選單 = true; 結果.鍵盤選擇 = true; 結果.運作中切換及釋放 = true;
    驗證.equal(await 網頁.evaluate(() => window.例外 ?? ''), '');
    await 網頁.evaluate(() => window.aquarius.stop());
    驗證.equal(await 網頁.locator('canvas').count(), 0);
    驗證.deepEqual(錯誤, []);
    await 寫入檔案(路徑.join(報告目錄, '網頁驗證.json'), JSON.stringify(結果, null, 2));
    console.log(JSON.stringify(結果));
} finally { await 瀏覽器.close(); await new Promise(完成 => 伺服器.close(完成)); }
