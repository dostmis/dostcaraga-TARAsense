module.exports = {
  apps: [
    {
      name: "tarasense-web",
      cwd: __dirname,
      script: "npm",
      args: "start -- -p 3000 -H 127.0.0.1",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      autorestart: true,
      max_memory_restart: "512M",
      time: true,
    },
  ],
};
