import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getBackendPort() {
    try {
        const settingsPath = path.resolve(__dirname, 'settings.json');
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed?.settings?.httpport || 8500;
    } catch {
        return 8500;
    }
}

const backendTarget = `http://127.0.0.1:${getBackendPort()}`;

export default defineConfig({
    root: path.resolve(__dirname, 'src'),
    publicDir: path.resolve(__dirname, 'public'),
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true
    },
    server: {
        proxy: {
            '/settings': backendTarget,
            '/status': backendTarget,
            '/job-state': backendTarget,
            '/clearjob': backendTarget,
            '/existingcount': backendTarget,
            '/sendexisting': backendTarget,
            '/make': backendTarget,
            '/download': backendTarget,
            '/cancel': backendTarget,
            '/ws': {
                target: backendTarget,
                ws: true
            }
        }
    }
});
