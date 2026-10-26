import http from 'http';
import config from './config/env.js';
import { bot } from './bot/telegramBot.js';
import { initScheduler } from './services/schedulerService.js';

console.log('====================================================');
console.log('🚀 INICIANDO MICROSERVICIO RRSS STORIES (TACOS BAR)');
console.log(`🌍 Entorno: ${config.system.env} | Zona Horaria: ${config.system.timezone}`);
console.log('====================================================');

// 1. Iniciar el Scheduler de Cronjobs
initScheduler(bot);

// 2. Iniciar el Bot de Telegram
bot.launch({
  dropPendingUpdates: true // Evita procesar mensajes antiguos acumulados tras reinicios
}).then(() => {
  console.log(`🤖 Telegram Bot conectado exitosamente como @${bot.botInfo?.username || 'Bot'}`);
  console.log(`🔒 IDs Autorizados configurados: ${config.telegram.allowedIds.size}`);
}).catch((error) => {
  console.error(`[CRITICAL] Error al iniciar Telegram Bot: ${error.message}`);
  process.exit(1);
});

// 3. Servidor HTTP mínimo para Health Checks (Liveness/Readiness probes en Docker / Kubernetes / PaaS)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'UP',
      service: 'rrss-stories-microservice',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(config.system.port, () => {
  console.log(`🩺 Health check disponible en http://localhost:${config.system.port}/health`);
});

// 4. Manejo de señales para Parada Graciosa (Graceful Shutdown)
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Recibida señal ${signal}. Cerrando microservicio de forma segura...`);
  
  // Detener el bot de Telegram
  try {
    bot.stop(signal);
  } catch (err) {
    console.warn(`[WARN] Error deteniendo bot: ${err.message}`);
  }

  // Cerrar servidor HTTP
  server.close(() => {
    console.log('✅ Servidor HTTP cerrado.');
    console.log('👋 Microservicio detenido limpiamente.');
    process.exit(0);
  });

  // Forzar salida tras 5 segundos si quedan conexiones colgadas
  setTimeout(() => {
    console.error('⚠️ Forzando cierre del proceso tras timeout.');
    process.exit(1);
  }, 5000).unref();
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION] Promesa no manejada:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION] Excepción no capturada:', error);
  // En fallos no recuperables se recomienda reiniciar el contenedor
  process.exit(1);
});
