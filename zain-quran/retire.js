(async () => {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter(registration => new URL(registration.scope).pathname.startsWith("/zain-quran/"))
      .map(registration => registration.unregister()));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.toLowerCase().includes("zain-quran") || key.toLowerCase().startsWith("zq-"))
      .map(key => caches.delete(key)));
  }
})();
