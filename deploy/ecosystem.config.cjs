module.exports = {
  apps: [
    {
      name: "fmea-api",
      cwd: "/home/ubuntu/fmea/server",
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 30000,
      time: true,
      merge_logs: true,
      env_production: {
        NODE_ENV: "production",
        HOST: process.env.HOST || "127.0.0.1",
        PORT: process.env.PORT || "3001",
        PG_HOST: process.env.PG_HOST,
        PG_PORT: process.env.PG_PORT || "5432",
        PG_USER: process.env.PG_USER,
        PG_PASSWORD: process.env.PG_PASSWORD,
        PG_DATABASE: process.env.PG_DATABASE,
      },
    },
  ],
};
