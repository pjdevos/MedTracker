const CACHE = 'medtracker-v2';
const DATA_CACHE = 'medtracker-data';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Ontvangt medicatiedata van de pagina en slaat het op
self.addEventListener('message', e => {
  if (e.data?.type === 'SYNC_MEDS') {
    saveMeds(e.data.meds).catch(() => {});
  }
});

// Periodic Background Sync: vuurt ook als de app gesloten is
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-reminders') {
    e.waitUntil(checkAndNotify());
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});

// --- Hulpfuncties ---

async function saveMeds(meds) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put('/meds-data', new Response(JSON.stringify(meds), {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function getMeds() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const resp = await cache.match('/meds-data');
    return resp ? await resp.json() : [];
  } catch { return []; }
}

async function checkAndNotify() {
  const meds = await getMeds();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const today = now.toDateString();
  let changed = false;

  for (const m of meds) {
    if (!m.reminderTime || m.lastReminderDate === today) continue;
    const [rh, rm] = m.reminderTime.split(':').map(Number);
    const remMins = rh * 60 + rm;
    // Stuur melding als herinneringstijd in de afgelopen 90 min viel
    // (buffer omdat de browser de sync niet exact op het juiste moment uitvoert)
    const diff = nowMins - remMins;
    if (diff >= 0 && diff < 90) {
      m.lastReminderDate = today;
      changed = true;
      await self.registration.showNotification(`Tijd om ${m.name} te nemen`, {
        body: `${m.emoji || '💊'} Nog ${m.doses} dosis${m.doses !== 1 ? 's' : ''} over`,
        icon: '/icon.svg',
        tag: `medtracker-${m.name}`,
        requireInteraction: false,
      });
    }
  }

  if (changed) await saveMeds(meds);
}
