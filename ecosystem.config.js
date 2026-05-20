module.exports = {
  apps: [{
    name: 'shortify-ai',
    script: 'npm',
    args: 'start',
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'production',
      PORT: 8000,
    },
  }],
};
