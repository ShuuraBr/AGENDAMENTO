import('./src/server.js')
  .then(() => {
    console.log('[OK] Backend iniciado via backend/server.js');
  })
  .catch((err) => {
    console.error('[FATAL] Erro ao iniciar backend pela pasta backend:', err);
    process.exit(1);
  });
