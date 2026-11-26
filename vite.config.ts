import { defineConfig, loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { BlockList, createConnection, createServer } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.API_PORT ?? 3001);

// Fixed-address mode uses a subnet-filtered proxy. Auto mode uses the host's LAN firewall rule.
function localNetworkAccess(): Plugin {
  return {
    name: 'jingshan-local-network',
    apply: 'serve',
    config(_config, { mode }) {
      if (loadEnv(mode, process.cwd(), 'JINGSHAN_DEV_LAN_IP').JINGSHAN_DEV_LAN_IP !== 'auto') return;
      const name = hostname().toLowerCase();
      return { server: { host: '0.0.0.0', allowedHosts: [name, name + '.local'] } };
    },
    configureServer(server) {
      const address = loadEnv(server.config.mode, server.config.envDir, 'JINGSHAN_DEV_LAN_IP').JINGSHAN_DEV_LAN_IP;
      const web = server.httpServer;
      if (!address || address === 'auto' || !web) return;
      const network = Object.values(networkInterfaces()).flat().find(entry =>
        entry && !entry.internal && entry.family === 'IPv4' && entry.address === address);
      if (!network?.cidr) {
        server.config.logger.warn(`局域网地址 ${address} 未配置在本机网卡上。`);
        return;
      }
      const allowed = new BlockList();
      allowed.addSubnet(address, Number(network.cidr.split('/')[1]), 'ipv4');
      web.once('listening', () => {
        const bound = web.address();
        if (!bound || typeof bound === 'string' || bound.address !== '127.0.0.1') return;
        const lan = createServer(client => {
          if (!client.remoteAddress || !allowed.check(client.remoteAddress, 'ipv4')) {
            client.destroy();
            return;
          }
          const upstream = createConnection(bound.port, bound.address);
          client.on('error', () => upstream.destroy());
          upstream.on('error', () => client.destroy());
          client.on('close', () => upstream.destroy());
          upstream.on('close', () => client.destroy());
          client.pipe(upstream).pipe(client);
        });
        lan.on('error', error => server.config.logger.error(`局域网入口启动失败：${error.message}`));
        lan.listen(bound.port, address, () => server.config.logger.info(`Wi-Fi: http://${address}:${bound.port}/`));
        web.once('close', () => lan.close());
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), localNetworkAccess()],
  optimizeDeps: { include: [
    'ol/Map.js','ol/View.js','ol/format/GeoJSON.js','ol/Feature.js','ol/geom/Point.js','ol/source/Vector.js','ol/layer/Vector.js',
    'ol/geom/LineString.js','ol/geom/Polygon.js',
    'ol/layer/Image.js','ol/source/ImageStatic.js','ol/interaction.js','ol/proj.js','ol/style.js',
    'ol/layer/Group.js','ol/layer/Tile.js','ol/source/Image.js','ol/source/ImageTile.js','ol/tilegrid.js','ol/uri.js','ol/color.js',
  ] },
  build: {
    rolldownOptions: {
      input: {
        jingshan: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)),
        workspace: fileURLToPath(new URL('./workspace/index.html', import.meta.url)),
        hubei: fileURLToPath(new URL('./hubei.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: [{
      find: /^cesium$/,
      replacement: fileURLToPath(new URL('./node_modules/cesium/Build/Cesium/index.js', import.meta.url)),
    }],
  },
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    fs: {
      deny: [
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
        '**/.git/**', '**/.local/**', '**/.npm-cache/**',
      ],
    },
    watch: { ignored: ['**/.local/**', '**/.npm-cache/**', '**/public/cesium/**'] },
  },
});
