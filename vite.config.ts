import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/car_driving/',
  plugins: [basicSsl()],
  server: { host: true },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
