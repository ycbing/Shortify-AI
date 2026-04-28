module.exports = {
  apps: [{
    name: 'shortify-ai',
    script: 'npm',
    args: 'start',
    cwd: 'YOUR_PROJECT_PATH',
    env: {
      NODE_ENV: 'production',
      PORT: 8000,
    },
  }],
};
