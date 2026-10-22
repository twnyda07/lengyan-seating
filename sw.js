/* 離線備用（Service Worker）
 *
 * 為什麼需要：10/24–26 早上是查詢尖峰，現場網路可能不穩，
 * GitHub 或 Google 也可能臨時出狀況。只要工作人員**開過一次**這個網站，
 * 之後即使完全斷網也還能查名單、查座位、印小卡。
 *
 * 策略：**先連網，連不到或太慢才用快取**。
 *
 * 第一版寫成「先給快取、背景更新」，結果連線正常時也看到舊資料 ——
 * 這套系統法會前每 5 分鐘就會變一次，**拿到舊名單比沒有離線備用更危險**
 * （座位改了卻照舊的帶位）。所以改成網路優先：
 * 4 秒內拿得到就用新的（順手更新快取），拿不到才退回快取，
 * 並通知頁面標示「目前是離線版」，讓工作人員知道手上的可能不是最新。
 */
/* 版本換掉，舊的快取會在 activate 時被清掉。
   v3（2026-10-22）：離線備用改成只給工作人員之後，信眾手機上還留著 v2 的快取，
   會一直餵他們舊頁面 —— 連「這一頁會自己註銷 SW」的新版都載不到。
   升版號就是為了讓瀏覽器抓到這支新的 sw.js 時，activate 把 v2 整個刪掉。 */
var 快取名 = '楞嚴座位-v4';
var 首頁 = './';
/* 工作人員那份密文現在是獨立檔（信眾不會下載它，省掉 1.4MB）。
   離線備用要把它一起存起來，否則工作人員斷網時打得開頁面卻解不出資料。 */
var 資料檔 = './d0.b64';
/* 等網路的時間。原本 4 秒，在手機上太短 ——
   這一頁是 2.4MB，行動網路常常 4 秒抓不完，於是每次都退回舊快取，
   使用者就一直看到舊公告、舊座位。放寬到 8 秒，真正斷網時才會落到快取。 */
var 等網路毫秒 = 8000;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(快取名).then(function (c) {
      return c.addAll([首頁, './version.json', 資料檔]).catch(function () { });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return k === 快取名 ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function 告訴頁面(訊) {
  return self.clients.matchAll({ type: 'window' }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage(訊); });
  });
}

/* 連網拿，拿到就順手更新快取；逾時或失敗才退回快取 */
function 網路優先(req, 快取鍵) {
  return new Promise(function (resolve) {
    var 已回應 = false;
    var 給快取 = function () {
      return caches.match(快取鍵).then(function (舊) {
        if (已回應 || !舊) return false;
        已回應 = true;
        告訴頁面({ 型: '離線版' });
        resolve(舊);
        return true;
      });
    };
    var 計 = setTimeout(給快取, 等網路毫秒);

    fetch(req).then(function (r) {
      clearTimeout(計);
      if (r && r.ok) {
        var copy = r.clone();
        caches.open(快取名).then(function (c) { c.put(快取鍵, copy); });
      }
      if (!已回應) { 已回應 = true; resolve(r); }
    }).catch(function () {
      clearTimeout(計);
      給快取().then(function (有) {
        if (有 || 已回應) return;
        已回應 = true;
        resolve(new Response('目前連不上網路，而且這台裝置還沒有存過備用檔。\n請連上網路再開一次，之後就能離線使用。',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // 只管自己這個網站

  if (/version\.json$/.test(url.pathname)) {
    e.respondWith(網路優先(req, './version.json'));
    return;
  }
  if (/d0\.b64$/.test(url.pathname)) {
    e.respondWith(網路優先(req, 資料檔));
    return;
  }
  // 頁面本身：網址結尾是目錄、或是 index.html
  var 尾 = url.pathname.replace(/\/+$/, '').split('/').pop();
  if (url.pathname.slice(-1) === '/' || 尾 === 'index.html' || 尾 === 'lengyan-seating') {
    e.respondWith(網路優先(req, 首頁));
  }
});
