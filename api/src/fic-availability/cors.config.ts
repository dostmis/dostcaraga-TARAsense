// CORS Configuration for FIC Availability
// This ensures the Next.js frontend can communicate with the NestJS API

export const FIC_CORS_CONFIG = {
  origin: [
    'http://localhost:3000',  // Development
    'http://127.0.0.1:3000',  // Alternative localhost
    'http://localhost:4000',  // API itself
    'http://api.tarasense.local',  // Production (add your domain)
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
  ],
  exposedHeaders: ['Set-Cookie'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Debug helper to log CORS issues
export function logCorsConfig() {
  console.log('🔐 CORS Configuration:');
  console.log('✓ Origins allowed:', FIC_CORS_CONFIG.origin.join(', '));
  console.log('✓ Credentials:', FIC_CORS_CONFIG.credentials);
  console.log('✓ Methods:', FIC_CORS_CONFIG.methods.join(', '));
}
