import('./backend/src/server.js')
  .then(() => {
    console.log('[OK] Backend iniciado via server.js raiz');
  })
  .catch((err) => {
    console.error('[FATAL] Erro ao iniciar backend:', err);
    process.exit(1);
  });
